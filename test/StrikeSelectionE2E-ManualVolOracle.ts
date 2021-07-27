import { network, ethers } from "hardhat";
import { assert, expect } from "chai";
import { Contract } from "@ethersproject/contracts";
import * as time from "./helpers/time";
import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import OptionsPremiumPricer_ABI from "../constants/abis/OptionsPremiumPricer.json";
import ManualVolOracle_ABI from "../constants/abis/ManualVolOracle.json";
import {
  OptionsPremiumPricer_BYTECODE,
  ManualVolOracle_BYTECODE,
} from "./helpers/constants";
const { getContractFactory } = ethers;

describe("StrikeSelectionE2E-ManualVolOracle", () => {
  let volOracle: Contract;
  let strikeSelection: Contract;
  let optionsPremiumPricer: Contract;
  let wethPriceOracle: Contract;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

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
    const ManualVolOracle = await getContractFactory(
      ManualVolOracle_ABI,
      ManualVolOracle_BYTECODE,
      signer
    );
    const OptionsPremiumPricer = await getContractFactory(
      OptionsPremiumPricer_ABI,
      OptionsPremiumPricer_BYTECODE,
      signer
    );
    const StrikeSelection = await getContractFactory("StrikeSelection", signer);

    volOracle = await ManualVolOracle.deploy(signer.address);

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
      volOracle
        .connect(signer)
        .setAnnualizedVol(
          ethusdcPool,
          BigNumber.from("15").mul(BigNumber.from("10").pow("7"))
        );
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

      // console.log(deltaAtUnderlying.toString());
      // console.log(targetDelta.toString());

      assert.equal(
        strikePrice.toString(),
        underlyingPrice
          .add(
            deltaAtUnderlying
              .sub(targetDelta)
              .div(500)
              .sub(1)
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
              .sub(4)
              .mul(100)
              .mul(BigNumber.from(10).pow(await wethPriceOracle.decimals()))
          )
          .toString()
      );

      assert.isBelow(
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
});
