import { network, ethers } from "hardhat";
import { assert, expect } from "chai";
import { Contract } from "@ethersproject/contracts";
import moment from "moment-timezone";
import * as time from "./helpers/time";
import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import OptionsPremiumPricer_ABI from "../constants/abis/OptionsPremiumPricer.json";
import TestVolOracle_ABI from "../constants/abis/TestVolOracle.json";
import {
  OptionsPremiumPricer_BYTECODE,
  TestVolOracle_BYTECODE,
} from "./helpers/constants";
const { provider, getContractFactory } = ethers;

moment.tz.setDefault("UTC");

describe("StrikeSelectionE2E", () => {
  let volOracle: Contract;
  let strikeSelection: Contract;
  let optionsPremiumPricer: Contract;
  let wethPriceOracle: Contract;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  const PERIOD = 43200; // 12 hours
  const WEEK = 604800; // 7 days

  const ethusdcPool = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";

  const wethPriceOracleAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
  const usdcPriceOracleAddress = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";

  before(async function () {
    // Reset block
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: 12529250,
          },
        },
      ],
    });

    [signer, signer2] = await ethers.getSigners();
    const TestVolOracle = await getContractFactory(
      TestVolOracle_ABI,
      TestVolOracle_BYTECODE,
      signer
    );
    const OptionsPremiumPricer = await getContractFactory(
      OptionsPremiumPricer_ABI,
      OptionsPremiumPricer_BYTECODE,
      signer
    );
    const StrikeSelection = await getContractFactory("StrikeSelection", signer);

    volOracle = await TestVolOracle.deploy(PERIOD);

    optionsPremiumPricer = await OptionsPremiumPricer.deploy(
      ethusdcPool,
      volOracle.address,
      wethPriceOracleAddress,
      usdcPriceOracleAddress
    );

    strikeSelection = await StrikeSelection.deploy(
      optionsPremiumPricer.address,
      1000,
      100
    );

    wethPriceOracle = await ethers.getContractAt(
      "IPriceOracle",
      await optionsPremiumPricer.priceOracle()
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
          .mul(BigNumber.from(10).pow(await wethPriceOracle.decimals()))
          .toString()
      );
    });
  });

  describe("getStrikePrice", () => {
    time.revertToSnapshotAfterEach();

    let underlyingPrice: BigNumber;
    let deltaAtUnderlying: BigNumber;
    let expiryTimestamp: BigNumber;

    beforeEach(async () => {
      await updateVol();
      underlyingPrice = await optionsPremiumPricer.getUnderlyingPrice();
      underlyingPrice = underlyingPrice.sub(
        BigNumber.from(underlyingPrice).mod(await strikeSelection.step())
      );
      expiryTimestamp = (await time.now()).add(WEEK);
      deltaAtUnderlying = await optionsPremiumPricer[
        "getOptionDelta(uint256,uint256)"
      ](underlyingPrice, expiryTimestamp);
    });

    it("reverts on timestamp being in the past", async function () {
      const isPut = false;
      await expect(
        strikeSelection.getStrikePrice((await time.now()).sub(100), isPut)
      ).to.be.revertedWith("Expiry must be in the future!");
    });

    it("gets the correct strike price given delta for calls", async function () {
      const isPut = false;
      const targetDelta = await strikeSelection.delta();
      const [strikePrice, delta] = await strikeSelection.getStrikePrice(
        expiryTimestamp,
        isPut
      );

      console.log(deltaAtUnderlying.toString());
      console.log(targetDelta.toString());

      assert.equal(
        strikePrice.toString(),
        underlyingPrice
          .add(
            deltaAtUnderlying
              .sub(targetDelta)
              .div(500)
              .mul(100)
              .mul(BigNumber.from(10).pow(await wethPriceOracle.decimals()))
          )
          .toString()
      );
      assert.isBelow(
        parseInt(targetDelta.toString()),
        parseInt(delta.toString())
      );
      assert.isAbove(
        parseInt(targetDelta.toString()),
        parseInt(
          await optionsPremiumPricer["getOptionDelta(uint256,uint256)"](
            strikePrice.add(await strikeSelection.step()),
            expiryTimestamp
          )
        )
      );
    });

    it("gets the correct strike price given delta for puts", async function () {
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
              .sub(3)
              .mul(100)
              .mul(BigNumber.from(10).pow(await wethPriceOracle.decimals()))
          )
          .toString()
      );

      assert.isAbove(
        parseInt(targetDelta.toString()),
        parseInt(BigNumber.from(10000).sub(delta).toString())
      );
      assert.isBelow(
        parseInt(targetDelta.toString()),
        parseInt(
          BigNumber.from(10000)
            .sub(
              await optionsPremiumPricer["getOptionDelta(uint256,uint256)"](
                strikePrice.add(await strikeSelection.step()),
                expiryTimestamp
              )
            )
            .toString()
        )
      );
    });
  });

  const getTopOfPeriod = async () => {
    const latestTimestamp = (await provider.getBlock("latest")).timestamp;
    let topOfPeriod: number;

    const rem = latestTimestamp % PERIOD;
    if (rem < Math.floor(PERIOD / 2)) {
      topOfPeriod = latestTimestamp - rem + PERIOD;
    } else {
      topOfPeriod = latestTimestamp + rem + PERIOD;
    }
    return topOfPeriod;
  };

  const updateVol = async () => {
    const values = [
      BigNumber.from("2000000000"),
      BigNumber.from("2100000000"),
      BigNumber.from("2200000000"),
      BigNumber.from("2150000000"),
      BigNumber.from("2250000000"),
      BigNumber.from("2350000000"),
      BigNumber.from("2450000000"),
      BigNumber.from("2550000000"),
      BigNumber.from("2350000000"),
      BigNumber.from("2450000000"),
      BigNumber.from("2250000000"),
      BigNumber.from("2250000000"),
      BigNumber.from("2650000000"),
    ];

    for (let i = 0; i < values.length; i++) {
      await volOracle.setPrice(values[i]);
      const topOfPeriod = (await getTopOfPeriod()) + PERIOD;
      await time.increaseTo(topOfPeriod);
      await volOracle.mockCommit(ethusdcPool);
    }
  };
});
