import { ethers } from "hardhat";
import { assert, expect } from "chai";
import { Contract } from "@ethersproject/contracts";
import moment from "moment-timezone";
import * as time from "../helpers/time";
import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const { provider, getContractFactory } = ethers;

describe("OptionsPremiumPricer", () => {
  let strikeSelection: Contract;
  let mockOptionsPremiumPricer: Contract;
  let signer: SignerWithAddress;
  let signer2: SignerWithAddress;

  const mockWethUnderlyingPrice = 2500;

  before(async function () {
    [signer, signer2] = await ethers.getSigners();
    const MockOptionsPremiumPricer = await getContractFactory("MockOptionsPremiumPricer", signer);
    const StrikeSelection = await getContractFactory(
      "StrikeSelection",
      signer
    );

    mockOptionsPremiumPricer = await MockOptionsPremiumPricer.deploy();

    strikeSelection = await StrikeSelection.deploy(
      mockOptionsPremiumPricer.address,
      10,
      10
    );
  });

  describe("setDelta", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when not owner call", async function () {
      await expect(strikeSelection.connect(signer2).setDelta(1)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("sets the delta", async function () {
      strikeSelection.connect(signer2).setDelta(50)
      assert.equal(await strikeSelection.delta(), "50");
    });
  });

  describe("setStep", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when not owner call", async function () {
      await expect(strikeSelection.connect(signer2).setStep(1)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("sets the delta", async function () {
      strikeSelection.connect(signer2).setStep(50)
      assert.equal(await strikeSelection.step(), "50");
    });
  });

  describe("getStrikePrice", () => {
    time.revertToSnapshotAfterEach();

    beforeEach(async () => {
      let delta = 0.3
      for(let i = -300; i < 400; i += 100){
        await mockOptionsPremiumPricer.setOptionDelta(mockWethUnderlyingPrice + i, delta);
        delta -= 0.05
      }

      // set up proper cap
      // set up proper delta
    });

    it("gets the correct strike price given delta", async function () {
      //TODO
    });

  });
});
