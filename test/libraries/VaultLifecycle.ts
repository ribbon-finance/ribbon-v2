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
    const TestVaultLifecycle = await ethers.getContractFactory(
      "TestVaultLifecycle"
    );
    lifecycle = await TestVaultLifecycle.deploy();
  });

  describe("getNextFriday", () => {
<<<<<<< HEAD
    time.revertToSnapshotAfterEach();
=======
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
>>>>>>> ff40f814149911cb84c79f8b4e984a861fc51276

    it("gets the first Friday, given the day of week is Saturday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      // The block we're hardcoded to is a Saturday
      const saturday = currentTime;

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

      // The block we're hardcoded to is a Saturday so we add +1 day to get to Sunday
      const sunday = currentTime.add(1, "days");

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

      // The block we're hardcoded to is a Saturday so we subtract 3 days to get to Thursday
      const thursday = currentTime.subtract(3, "days");

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

      const thisFriday = currentTime
        .subtract(1, "days")
        .hours(8)
        .minutes(0)
        .seconds(0); // set to 8am UTc

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

      const thisFriday = moment(currentTime)
        .subtract(1, "days")
        .hours(9)
        .minutes(0)
        .seconds(0); // set to 8am U

      const expectedFriday = moment(currentTime)
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
