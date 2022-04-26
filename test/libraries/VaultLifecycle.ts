import { ethers } from "hardhat";
import { Contract, BigNumber } from "ethers";
import moment from "moment-timezone";
import { assert } from "../helpers/assertions";
import * as time from "../helpers/time";
import {
  CHAINID,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
  GNOSIS_EASY_AUCTION,
} from "../../constants/constants";
import { decodeOrder } from "../helpers/utils";
import { parseUnits } from "@ethersproject/units";

moment.tz.setDefault("UTC");

const AUCTION_ID = 146;
const AUCTION_SETTLEMENT_PRICE = parseUnits("0.0032", 18);

const provider = ethers.provider;

describe("VaultLifecycle", () => {
  let lifecycle: Contract;

  before(async () => {
    const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
    const lifecycleLib = await VaultLifecycle.deploy();

    const TestVaultLifecycle = await ethers.getContractFactory(
      "TestVaultLifecycle",
      { libraries: { VaultLifecycle: lifecycleLib.address } }
    );
    lifecycle = await TestVaultLifecycle.deploy();
  });

  describe("getNextFriday", () => {
    time.revertToSnapshotAfterEach(async () => {
      const { timestamp } = await provider.getBlock("latest");

      const currentTime = moment.unix(timestamp);

      const nextFriday = moment(currentTime)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(9); // needs to be 8am UTC

      await time.increaseTo(nextFriday.unix());
    });

    it("gets the first Friday, given the day of week is Saturday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      // The block we're hardcoded to is a Friday so we add 1 day to get to Saturday
      const saturday = currentTime.add(1, "days");

      const expectedFriday = moment(saturday)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextFriday(saturday.unix());
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);

      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("gets the first Friday, given the day of week is Sunday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      // The block we're hardcoded to is a Friday so we add 1 day to get to Sunday
      const sunday = currentTime.add(2, "days");

      const expectedFriday = moment(sunday)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextFriday(sunday.unix());
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);

      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("gets the first Friday, given the day of week is Thursday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      // The block we're hardcoded to is a Friday so we subtract 1 day to get to Thursday
      const thursday = currentTime.add(-1, "days");

      const expectedFriday = moment(thursday)
        .startOf("isoWeek")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextFriday(thursday.unix());
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);

      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("gets the next Friday, given the day of week is Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thisFriday = currentTime.hours(8).minutes(0).seconds(0); // set to 8am UTc

      const expectedFriday = moment(thisFriday)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextFriday(thisFriday.unix());
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);

      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("gets the next Friday, given the day of week is Friday, but after 8am UTC", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thisFriday = moment(currentTime);

      const expectedFriday = currentTime
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextFriday(thisFriday.unix());
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });
  });

  describe("getNextExpiry", () => {
    let factory: Contract;

    time.revertToSnapshotAfterEach(async () => {
      factory = await ethers.getContractAt(
        "IOtokenFactory",
        OTOKEN_FACTORY[CHAINID.ETH_MAINNET]
      );
    });

    it("returns the next friday if options is address(0)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const nextFriday = await lifecycle.getNextExpiry(
        ethers.constants.AddressZero
      );

      const expectedFriday = currentTime
        .startOf("isoWeek")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("returns the next friday if current options expired, but less than a week", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thisFriday = currentTime
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8)
        .minutes(0)
        .seconds(0); // needs to be 8am UTC

      const thisFridayTimestamp = thisFriday.clone().unix();

      const otokenArgs = [
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        USDC_ADDRESS[CHAINID.ETH_MAINNET],
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        parseUnits("3000", 8),
        thisFridayTimestamp,
        false,
      ];

      await factory.createOtoken(...otokenArgs);

      const otoken = await factory.getOtoken(...otokenArgs);

      await time.increaseTo(thisFridayTimestamp + 1);

      const nextFriday = await lifecycle.getNextExpiry(otoken);

      const expectedFriday = thisFriday
        .clone()
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("returns the next friday if current options expired by more than a week", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thisFriday = currentTime
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8)
        .minutes(0)
        .seconds(0); // needs to be 8am UTC

      const nextFriday = thisFriday.clone().add(1, "week");

      const thisFridayTimestamp = thisFriday.clone().unix();

      const otokenArgs = [
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        USDC_ADDRESS[CHAINID.ETH_MAINNET],
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        parseUnits("3000", 8),
        thisFridayTimestamp,
        false,
      ];

      await factory.createOtoken(...otokenArgs);

      const otoken = await factory.getOtoken(...otokenArgs);

      await time.increaseTo(nextFriday.clone().unix() + 1);

      const nextNextFriday = await lifecycle.getNextExpiry(otoken);

      const expectedFriday = nextFriday.clone().add(1, "week");

      const fridayDate = moment.unix(nextNextFriday);
      assert.equal(fridayDate.weekday(), 5);
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });
  });

  describe("getAuctionSettlementPrice", () => {
    let gnosisAuction: Contract;

    time.revertToSnapshotAfterEach(async () => {
      gnosisAuction = await ethers.getContractAt(
        "IGnosisAuction",
        GNOSIS_EASY_AUCTION[CHAINID.ETH_MAINNET]
      );
    });

    it("should get exact auction settlement price", async () => {
      const settlementPrice = await lifecycle.getAuctionSettlementPrice(
        GNOSIS_EASY_AUCTION[CHAINID.ETH_MAINNET],
        AUCTION_ID
      );

      assert.bnEqual(settlementPrice, AUCTION_SETTLEMENT_PRICE);
    });

    it("should equal clearing price order", async () => {
      const decimals = 8;

      const auctionDetails = await gnosisAuction.auctionData(AUCTION_ID);
      const clearingPriceOrder = decodeOrder(auctionDetails.clearingPriceOrder);

      const expectedSettlementPrice = BigNumber.from(10)
        .pow(decimals)
        .mul(clearingPriceOrder.sellAmount)
        .div(clearingPriceOrder.buyAmount);

      const settlementPrice = await lifecycle.getAuctionSettlementPrice(
        GNOSIS_EASY_AUCTION[CHAINID.ETH_MAINNET],
        AUCTION_ID
      );

      assert.bnEqual(settlementPrice, expectedSettlementPrice);
    });
  });
});
