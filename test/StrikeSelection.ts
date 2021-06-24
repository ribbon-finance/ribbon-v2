import { ethers } from "hardhat";
import { assert, expect } from "chai";
import { Contract } from "@ethersproject/contracts";
import * as time from "./helpers/time";
import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const { getContractFactory } = ethers;

describe("StrikeSelection", () => {
  let strikeSelection: Contract;
  let mockOptionsPremiumPricer: Contract;
  let mockPriceOracle: Contract;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  before(async function () {
    [signer, signer2] = await ethers.getSigners();
    const MockOptionsPremiumPricer = await getContractFactory(
      "MockOptionsPremiumPricer",
      signer
    );
    const MockPriceOracle = await getContractFactory("MockPriceOracle", signer);
    const StrikeSelection = await getContractFactory("StrikeSelection", signer);

    mockOptionsPremiumPricer = await MockOptionsPremiumPricer.deploy();

    mockPriceOracle = await MockPriceOracle.deploy();

    await mockOptionsPremiumPricer.setPriceOracle(mockPriceOracle.address);
    await mockPriceOracle.setDecimals(8);
    await mockOptionsPremiumPricer.setOptionUnderlyingPrice(
      BigNumber.from(2500).mul(
        BigNumber.from(10).pow(await mockPriceOracle.decimals())
      )
    );

    strikeSelection = await StrikeSelection.deploy(
      mockOptionsPremiumPricer.address,
      1000,
      100
    );
  });

  describe("setDelta", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when not owner call", async function () {
      await expect(
        strikeSelection.connect(signer2).setDelta(5000)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("sets the delta", async function () {
      await strikeSelection.connect(signer).setDelta(5000);
      assert.equal((await strikeSelection.delta()).toString(), "5000");
    });
  });

  describe("setStep", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when not owner call", async function () {
      await expect(
        strikeSelection.connect(signer2).setStep(50)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("sets the step", async function () {
      await strikeSelection.connect(signer).setStep(50);
      assert.equal(
        (await strikeSelection.step()).toString(),
        BigNumber.from(50)
          .mul(BigNumber.from(10).pow(await mockPriceOracle.decimals()))
          .toString()
      );
    });
  });

  describe("getStrikePrice", () => {
    time.revertToSnapshotAfterEach();

    let underlyingPrice: BigNumber;
    let deltaAtUnderlying = BigNumber.from(5000);

    beforeEach(async () => {
      underlyingPrice = await mockOptionsPremiumPricer.getUnderlyingPrice();

      let delta = 10000;
      for (let i = -1000; i < 1100; i += 100) {
        await mockOptionsPremiumPricer.setOptionDelta(
          underlyingPrice.add(
            BigNumber.from(i).mul(
              BigNumber.from(10).pow(await mockPriceOracle.decimals())
            )
          ),
          delta
        );
        delta -= 500;
      }
    });

    it("reverts on timestamp being in the past", async function () {
      const expiryTimestamp = (await time.now()).sub(100);
      const isPut = false;
      await expect(
        strikeSelection.getStrikePrice(expiryTimestamp, isPut)
      ).to.be.revertedWith("Expiry must be in the future!");
    });

    it("gets the correct strike price given uneven underlying strike price", async function () {
      const expiryTimestamp = (await time.now()).add(100);
      const isPut = false;
      const targetDelta = await strikeSelection.delta();

      await mockOptionsPremiumPricer.setOptionUnderlyingPrice(
        BigNumber.from(2578).mul(
          BigNumber.from(10).pow(await mockPriceOracle.decimals())
        )
      );

      const [strikePrice, delta] = await strikeSelection.getStrikePrice(
        expiryTimestamp,
        isPut
      );

      assert.equal(
        strikePrice.toString(),
        underlyingPrice
          .add(
            deltaAtUnderlying
              .sub(targetDelta)
              .div(500)
              .mul(100)
              .mul(BigNumber.from(10).pow(await mockPriceOracle.decimals()))
          )
          .toString()
      );
      assert.equal(delta.toString(), targetDelta.toString());
    });

    it("gets the correct strike price given delta for calls", async function () {
      const expiryTimestamp = (await time.now()).add(100);
      const isPut = false;
      const targetDelta = await strikeSelection.delta();
      const [strikePrice, delta] = await strikeSelection.getStrikePrice(
        expiryTimestamp,
        isPut
      );
      assert.equal(
        strikePrice.toString(),
        underlyingPrice
          .add(
            deltaAtUnderlying
              .sub(targetDelta)
              .div(500)
              .mul(100)
              .mul(BigNumber.from(10).pow(await mockPriceOracle.decimals()))
          )
          .toString()
      );
      assert.equal(delta.toString(), targetDelta.toString());
    });

    it("gets the correct strike price given delta for puts", async function () {
      const expiryTimestamp = (await time.now()).add(100);
      const isPut = true;
      const targetDelta = await strikeSelection.delta();
      const [strikePrice, delta] = await strikeSelection.getStrikePrice(
        expiryTimestamp,
        isPut
      );
      assert.equal(
        strikePrice.toString(),
        underlyingPrice
          .sub(
            deltaAtUnderlying
              .sub(targetDelta)
              .div(500)
              .mul(100)
              .mul(BigNumber.from(10).pow(await mockPriceOracle.decimals()))
          )
          .toString()
      );
      assert.equal(
        BigNumber.from(10000).sub(delta).toString(),
        targetDelta.toString()
      );
    });
  });
});
