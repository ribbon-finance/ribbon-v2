import { ethers } from "hardhat";
import { Contract } from "ethers";
import moment from "moment-timezone";
import { assert } from "../helpers/assertions";
import * as time from "../helpers/time";

moment.tz.setDefault("UTC");

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
});
