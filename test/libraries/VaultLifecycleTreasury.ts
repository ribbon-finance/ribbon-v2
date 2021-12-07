import { ethers } from "hardhat";
import { Contract } from "ethers";
import moment from "moment-timezone";
import { assert } from "../helpers/assertions";
import * as time from "../helpers/time";
import exp from "constants";

moment.tz.setDefault("UTC");

const provider = ethers.provider;

describe("VaultLifecycleTreasury", () => {
  let lifecycle: Contract;

  before(async () => {
    const VaultLifecycleTreasury = await ethers.getContractFactory("VaultLifecycleTreasury");
    const lifecycleLib = await VaultLifecycleTreasury.deploy();

    const TestVaultLifecycleTreasury = await ethers.getContractFactory(
      "TestVaultLifecycleTreasury",
      // { libraries: { VaultLifecycleTreasury: lifecycleLib.address } }
    );
    lifecycle = await TestVaultLifecycleTreasury.deploy();
  });

  describe("getNextExpiry", () => {
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

    it("gets the next Friday, given the day of week is Saturday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      // The block we're hardcoded to is a Friday so we add 1 day to get to Saturday
      const saturday = currentTime.add(1, "days");

      const expectedFriday = moment(saturday)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        saturday.unix(),
        5,
        7,
        true
      );
      
      const fridayDate = moment.unix(nextFriday);
      
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("gets the next Friday, given the day of week is Sunday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      // The block we're hardcoded to is a Friday so we add 1 day to get to Sunday
      const sunday = currentTime.add(2, "days");

      const expectedFriday = moment(sunday)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        sunday.unix(),
        5,
        7,
        true
      );
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);

      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("gets the next Friday, given the day of week is Thursday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      // The block we're hardcoded to is a Friday so we subtract 1 day to get to Thursday
      const thursday = currentTime.add(-1, "days");

      const expectedFriday = moment(thursday)
        .startOf("isoWeek")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        thursday.unix(),
        5,
        7,
        true
      );
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

      const nextFriday = await lifecycle.getNextExpiry(
        thisFriday.unix(),
        5,
        7,
        false
      );
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

      const nextFriday = await lifecycle.getNextExpiry(
        thisFriday.unix(),
        5,
        7,
        false
      );
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 7, initial = true] Thursday (03 Jun) → Friday (04 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thursday = currentTime.add(-1, "days");

      const expectedFriday = moment(thursday)
        .startOf("isoWeek")
        // .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        thursday.unix(),
        5,
        7,
        true
      );

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 7, initial = false] Thursday (03 Jun) → Friday (11 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thursday = currentTime.add(-1, "days");

      const expectedFriday = moment(thursday)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        thursday.unix(),
        5,
        7,
        false
      );

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 14, initial = true] Thursday (03 Jun) → Friday (04 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thursday = currentTime.add(-1, "days");

      const expectedFriday = moment(thursday)
        .startOf("isoWeek")
        // .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        thursday.unix(),
        5,
        14,
        true
      );

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 14, initial = true] Thursday (03 Jun) → Friday (04 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thursday = currentTime.add(-1, "days");

      const expectedFriday = moment(thursday)
        .startOf("isoWeek")
        // .add(2, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        thursday.unix(),
        5,
        14,
        true
      );

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 14, initial = true] Thursday (03 Jun) → Friday (18 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const thursday = currentTime.add(1, "days");

      const expectedFriday = moment(thursday)
        .startOf("isoWeek")
        .add(2, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        thursday.unix(),
        5,
        14,
        false
      );

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 14, initial = true] Saturday (05 Jun) → Friday (11 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const saturday = currentTime.add(1, "days");

      const expectedFriday = moment(saturday)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        saturday.unix(),
        5,
        14,
        true
      );

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 14, initial = false] Saturday (05 Jun) → Friday (18 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const saturday = currentTime.add(1, "days");

      const expectedFriday = moment(saturday)
        .startOf("isoWeek")
        .add(2, "week")
        .day("friday")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        saturday.unix(),
        5,
        14,
        false
      );
      
      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 30, initial = true] Saturday (05 Jun) → Friday (25 Jun)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const saturday = currentTime.add(1, "days");

      const expectedFriday = moment(saturday)
        .startOf("month")
        .add(24, "day")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        saturday.unix(),
        5,
        30,
        true
      );

      const fridayDate = moment.unix(nextFriday);
      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });

    it("[day = 5, period = 30, initial = false] Saturday (05 Jun) → Friday (30 Jul)", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      const saturday = currentTime.add(1, "days");

      const expectedFriday = moment(saturday)
        .add(1, "month")
        .startOf("month")
        .add(29, "day")
        .hour(8); // needs to be 8am UTC

      const nextFriday = await lifecycle.getNextExpiry(
        saturday.unix(),
        5,
        30,
        false
      );

      const fridayDate = moment.unix(nextFriday);

      assert.equal(fridayDate.weekday(), 5);
      
      assert.isTrue(fridayDate.isSame(expectedFriday));
    });
  });
});
