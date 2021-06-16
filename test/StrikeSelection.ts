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
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  before(async function () {
    [signer, signer2] = await ethers.getSigners();
    const MockOptionsPremiumPricer = await getContractFactory(
      "MockOptionsPremiumPricer",
      signer
    );
    const StrikeSelection = await getContractFactory("StrikeSelection", signer);

    mockOptionsPremiumPricer = await MockOptionsPremiumPricer.deploy();

    strikeSelection = await StrikeSelection.deploy(
      mockOptionsPremiumPricer.address,
      10,
      100
    );

    await mockOptionsPremiumPricer.setOptionUnderlyingPrice(2500);
  });

  describe("setDelta", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when not owner call", async function () {
      await expect(
        strikeSelection.connect(signer2).setDelta(50)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("sets the delta", async function () {
      await strikeSelection.connect(signer).setDelta(50);
      assert.equal((await strikeSelection.delta()).toString(), "50");
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
      assert.equal((await strikeSelection.step()).toString(), "50");
    });
  });

  describe("getStrikePrice", () => {
    time.revertToSnapshotAfterEach();

    let underlyingPrice: BigNumber;
    let deltaAtUnderlying = BigNumber.from(50);

    beforeEach(async () => {
      underlyingPrice = await mockOptionsPremiumPricer.getUnderlyingPrice();

      let delta = 100;
      for (let i = -1000; i < 1100; i += 100) {
        await mockOptionsPremiumPricer.setOptionDelta(
          underlyingPrice.add(BigNumber.from(i)),
          delta
        );
        delta -= 5;
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

      await mockOptionsPremiumPricer.setOptionUnderlyingPrice(2578);

      const [strikePrice, delta] = await strikeSelection.getStrikePrice(
        expiryTimestamp,
        isPut
      );

      assert.equal(
        strikePrice.toString(),
        underlyingPrice
          .add(deltaAtUnderlying.sub(targetDelta).div(5).mul(100)).mul(BigNumber.from(10).pow(8))
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
          .add(deltaAtUnderlying.sub(targetDelta).div(5).mul(100)).mul(BigNumber.from(10).pow(8))
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
          .sub(deltaAtUnderlying.sub(targetDelta).div(5).mul(100)).mul(BigNumber.from(10).pow(8))
          .toString()
      );
      assert.equal(
        BigNumber.from(100).sub(delta).toString(),
        targetDelta.toString()
      );
    });
  });
});
