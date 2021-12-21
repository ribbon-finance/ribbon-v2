import { ethers } from "hardhat";
import { Contract } from "ethers";
import moment from "moment-timezone";
import { assert } from "../helpers/assertions";
import * as time from "../helpers/time";

moment.tz.setDefault("UTC");

const provider = ethers.provider;

describe("VaultLifecycleTreasury", () => {
  let lifecycle: Contract;

  before(async () => {
    const VaultLifecycleTreasury = await ethers.getContractFactory("VaultLifecycleTreasury");
    await VaultLifecycleTreasury.deploy();

    const TestVaultLifecycleTreasury = await ethers.getContractFactory(
      "TestVaultLifecycleTreasury",
    );
    lifecycle = await TestVaultLifecycleTreasury.deploy();
  });

  describe("getNextExpiry", () => {
    time.revertToSnapshotAfterEach(async () => {
      const { timestamp } = await provider.getBlock("latest");

      const now = moment.unix(timestamp);

      const startDate = moment(now)
        .startOf("isoWeek")
        .add(1, "week")
        .hour(9); // needs to be 8am UTC

      await time.increaseTo(startDate.unix()); // May 31, 2021
    });

    it("Gets the same initial weekly Friday expiry, when the current day is before Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 7;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
          .startOf("isoWeek")
          .day(weekday)
          .hour(8);

      for (let i = 0; i < 4; i++) {
        inputTime = moment(currentTime).add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the same initial weekly Friday expiry, when the current day is or is after Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 7;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
          .startOf("isoWeek")
          .add(1, "week")
          .day(weekday)
          .hour(8);

      for (let i = 4; i < 7; i++) {
        inputTime = moment(currentTime).add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the same Friday expiry when period is set to 2 weeks, when the current day is before Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 14;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
          .startOf("isoWeek")
          .day(weekday)
          .hour(8);

      for (let i = 0; i < 4; i++) {
        inputTime = moment(currentTime).add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the same Friday expiry when period is set to 2 weeks, when the current day is Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 14;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
          .startOf("isoWeek")
          .add(2, "week")
          .day(weekday)
          .hour(8);

      inputTime = moment(currentTime).add(weekday - 1, "day");

      nextExpiry = await lifecycle.getNextExpiry(
        inputTime.unix(), period
      );

      nextExpiryDate = moment.unix(nextExpiry);

      assert.equal(nextExpiryDate.weekday(), weekday);
      assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));

    });

    it("Gets the same Friday expiry when period is set to 2 weeks, when the current day is after Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 14;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
          .startOf("isoWeek")
          .add(1, "week")
          .day(weekday)
          .hour(8);

      for (let i = 5; i < 7; i++) {
        inputTime = moment(currentTime).add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the same monthly Friday expiry, regardless of the day in the month", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 30;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .add(25, "day")
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        inputTime = moment(currentTime).add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the same next month Friday expiry, when the given timestamp is after the corresponding month's expiry", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp)
        .add(7, "day");

      let weekday = 5;
      let period = 30;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .add(53, "day")
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        inputTime = moment(currentTime).add(Number(i) + 18, "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the correct monthly Friday expiry, when the last day of the month is a Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 30;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("april")
        .date(30)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        inputTime = moment(currentTime)
          .month("april")
          .date(6)
          .add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the correct next month Friday expiry, when the last day of the month is a Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 30;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("april")
        .date(30)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        inputTime = moment(currentTime)
          .month("april")
          .date(5)
          .add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the correct quarterly expiry", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 90;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        inputTime = moment(currentTime)
          .month("may")
          .date(10)
          .add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the correct quarterly expiry, when the current timestamp is on the previous quarterly expiry", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 90;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      inputTime = moment(currentTime)
        .month("march")
        .year(2021)
        .date(26);

      nextExpiry = await lifecycle.getNextExpiry(
        inputTime.unix(), period
      );

      nextExpiryDate = moment.unix(nextExpiry);

      assert.equal(nextExpiryDate.weekday(), weekday);
      assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
    });

    it("Gets the correct quarterly expiry, when the current timestamp is in December", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 90;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("march")
        .year(2022)
        .date(25)
        .hour(8)
        .seconds(0);

      inputTime = moment(currentTime)
        .month("december")
        .date(31);

      nextExpiry = await lifecycle.getNextExpiry(
        inputTime.unix(), period
      );

      nextExpiryDate = moment.unix(nextExpiry);

      assert.equal(nextExpiryDate.weekday(), weekday);
      assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
    });

    it("Gets the correct semiannual expiry", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 180;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        inputTime = moment(currentTime)
          .month("feb")
          .date(22)
          .add(Number(i), "day");

        nextExpiry = await lifecycle.getNextExpiry(
          inputTime.unix(), period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the correct semiannual expiry, when the current timestamp is on the previous semiannual expiry", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 180;
      let inputTime: moment.Moment;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      inputTime = moment(currentTime)
        .month("dec")
        .year(2020)
        .date(25);

      nextExpiry = await lifecycle.getNextExpiry(
        inputTime.unix(), period
      );

      nextExpiryDate = moment.unix(nextExpiry);

      assert.equal(nextExpiryDate.weekday(), weekday);
      assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
    });
  });
});
