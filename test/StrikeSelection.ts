import { ethers } from "hardhat";
import { assert, expect } from "chai";
import { Contract } from "ethers";
import * as time from "./helpers/time";
import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";

const { getContractFactory } = ethers;

describe("DeltaStrikeSelection", () => {
  let strikeSelection: Contract;
  let mockOptionsPremiumPricer: Contract;
  let mockPriceOracle: Contract;
  let mockVolatilityOracle: Contract;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  before(async function () {
    [signer, signer2] = await ethers.getSigners();
    const MockOptionsPremiumPricer = await getContractFactory(
      "MockOptionsPremiumPricer",
      signer
    );
    const MockPriceOracle = await getContractFactory("MockPriceOracle", signer);
    const MockVolatilityOracle = await getContractFactory(
      "MockVolatilityOracle",
      signer
    );
    const StrikeSelection = await getContractFactory(
      "DeltaStrikeSelection",
      signer
    );

    mockOptionsPremiumPricer = await MockOptionsPremiumPricer.deploy();

    mockPriceOracle = await MockPriceOracle.deploy();
    mockVolatilityOracle = await MockVolatilityOracle.deploy();

    await mockOptionsPremiumPricer.setPriceOracle(mockPriceOracle.address);
    await mockOptionsPremiumPricer.setVolatilityOracle(
      mockVolatilityOracle.address
    );
    await mockOptionsPremiumPricer.setPool(mockPriceOracle.address);
    await mockPriceOracle.setDecimals(8);
    await mockVolatilityOracle.setAnnualizedVol(1);

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

describe("PercentStrikeSelection", () => {
  let strikeSelection: Contract;
  let mockOptionsPremiumPricer: Contract;
  let mockPriceOracle: Contract;
  let mockVolatilityOracle: Contract;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;
  let multiplier: number;

  before(async function () {
    [signer, signer2] = await ethers.getSigners();
    const MockOptionsPremiumPricer = await getContractFactory(
      "MockOptionsPremiumPricer",
      signer
    );
    const MockPriceOracle = await getContractFactory("MockPriceOracle", signer);
    const MockVolatilityOracle = await getContractFactory(
      "MockVolatilityOracle",
      signer
    );
    const StrikeSelection = await getContractFactory(
      "PercentStrikeSelection",
      signer
    );

    mockOptionsPremiumPricer = await MockOptionsPremiumPricer.deploy();

    mockPriceOracle = await MockPriceOracle.deploy();
    mockVolatilityOracle = await MockVolatilityOracle.deploy();

    await mockOptionsPremiumPricer.setPriceOracle(mockPriceOracle.address);
    await mockOptionsPremiumPricer.setVolatilityOracle(
      mockVolatilityOracle.address
    );
    await mockOptionsPremiumPricer.setPool(mockPriceOracle.address);
    await mockPriceOracle.setDecimals(8);
    await mockVolatilityOracle.setAnnualizedVol(1);

    await mockOptionsPremiumPricer.setOptionUnderlyingPrice(
      BigNumber.from(2500).mul(
        BigNumber.from(10).pow(await mockPriceOracle.decimals())
      )
    );

    multiplier = 150;
    strikeSelection = await StrikeSelection.deploy(
      mockOptionsPremiumPricer.address,
      BigNumber.from(100).mul(10 ** (await mockPriceOracle.decimals())),
      multiplier
    );
  });

  describe("setStep", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when not owner call", async function () {
      await expect(
        strikeSelection
          .connect(signer2)
          .setStep(BigNumber.from(50).mul(await mockPriceOracle.decimals()))
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("sets the step", async function () {
      await strikeSelection
        .connect(signer)
        .setStep(BigNumber.from(50).mul(await mockPriceOracle.decimals()));
      assert.equal(
        (await strikeSelection.step()).toString(),
        BigNumber.from(BigNumber.from(50).mul(await mockPriceOracle.decimals()))
          .mul(BigNumber.from(10).pow(await mockPriceOracle.decimals()))
          .toString()
      );
    });
  });

  describe("setStrikeMultiplier", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when not owner call", async function () {
      await expect(
        strikeSelection.connect(signer2).setStrikeMultiplier(multiplier)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts when multiplier is below 1", async function () {
      await expect(
        strikeSelection.connect(signer).setStrikeMultiplier(80)
      ).to.be.revertedWith("Multiplier must be bigger than 1");
    });

    it("reverts when multiplier is equal 1", async function () {
      await expect(
        strikeSelection.connect(signer).setStrikeMultiplier(100)
      ).to.be.revertedWith("Multiplier must be bigger than 1");
    });

    it("sets the strike multiplier", async function () {
      await strikeSelection.connect(signer).setStrikeMultiplier(multiplier);
      assert.equal(
        (await strikeSelection.strikeMultiplier()).toString(),
        multiplier.toString()
      );
    });
  });

  describe("getStrikePrice", () => {
    time.revertToSnapshotAfterEach();

    let underlyingPrice: BigNumber;

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

    it("gets the correct strike price given multiplier for calls", async function () {
      const expiryTimestamp = (await time.now()).add(100);
      const isPut = false;
      const [strikePrice] = await strikeSelection.getStrikePrice(
        expiryTimestamp,
        isPut
      );

      let correctStrike = underlyingPrice.mul(multiplier).div(100);

      correctStrike = correctStrike.add(
        100 * 10 ** 8 - (correctStrike.toNumber() % (100 * 10 ** 8))
      );

      assert.equal(strikePrice.toString(), correctStrike.toString());
    });
  });
});
