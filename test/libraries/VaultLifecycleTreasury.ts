import moment from "moment-timezone";
import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { assert } from "../helpers/assertions";
import * as time from "../helpers/time";
import { TEST_URI } from "../../scripts/helpers/getDefaultEthersProvider";
import { CHAINID } from "../../constants/constants";
moment.tz.setDefault("UTC");

const provider = ethers.provider;

describe("VaultLifecycleTreasury", () => {
  let lifecycle: Contract;
  let SECONDS_PER_DAY = 86400;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: TEST_URI[CHAINID.ETH_MAINNET],
            blockNumber: 13505726,
          },
        },
      ],
    });
    const VaultLifecycleTreasury = await ethers.getContractFactory(
      "VaultLifecycleTreasury"
    );

    await VaultLifecycleTreasury.deploy();

    const TestVaultLifecycleTreasury = await ethers.getContractFactory(
      "TestVaultLifecycleTreasury"
    );
    lifecycle = await TestVaultLifecycleTreasury.deploy();
  });

  describe("getNextExpiryForPeriod", () => {
    time.revertToSnapshotAfterEach(async () => {
      const { timestamp } = await provider.getBlock("latest");

      const now = moment.unix(timestamp);

      const startDate = moment(now).startOf("isoWeek").add(1, "week").hour(9); // needs to be 8am UTC

      await time.increaseTo(startDate.unix()); // May 31, 2021
    });

    it("Gets the same initial weekly Friday expiry, when the current day is before Friday", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp);

      let weekday = 5;
      let period = 7;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .startOf("isoWeek")
        .day(weekday)
        .hour(8);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .startOf("isoWeek")
        .day(weekday)
        .hour(8);

      for (let i = 0; i < 4; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .startOf("isoWeek")
        .add(1, "week")
        .day(weekday)
        .hour(8);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .startOf("isoWeek")
        .add(1, "week")
        .day(weekday)
        .hour(8);

      for (let i = 4; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .startOf("isoWeek")
        .day(weekday)
        .add(1, "week")
        .hour(8);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .startOf("isoWeek")
        .add(1, "week")
        .day(weekday)
        .hour(8);

      for (let i = 0; i < 4; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .startOf("isoWeek")
        .add(2, "week")
        .day(weekday)
        .hour(8);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .startOf("isoWeek")
        .add(2, "week")
        .day(weekday)
        .hour(8);

      nextExpiry = await lifecycle.getNextExpiryForPeriod(
        previousExpiry.unix(),
        period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .startOf("isoWeek")
        .add(2, "weeks")
        .day(weekday)
        .hour(8);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .startOf("isoWeek")
        .add(2, "week")
        .day(weekday)
        .hour(8);

      for (let i = 5; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .add(25, "day")
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .add(25, "day")
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
        );

        nextExpiryDate = moment.unix(nextExpiry);

        assert.equal(nextExpiryDate.weekday(), weekday);
        assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
      }
    });

    it("Gets the same next month Friday expiry, when the given timestamp is after the corresponding month's expiry", async () => {
      const { timestamp } = await provider.getBlock("latest");
      const currentTime = moment.unix(timestamp).add(7, "day");

      let weekday = 5;
      let period = 30;
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .add(53, "day")
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        currentTime.unix() - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .add(53, "day")
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("april")
        .date(30)
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .month("march")
        .date(31)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("april")
        .date(30)
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .month("march")
        .date(31)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .month("march")
        .date(27)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .month("march")
        .date(27)
        .hour(8)
        .seconds(0);

      nextExpiry = await lifecycle.getNextExpiryForPeriod(
        previousExpiry.unix(),
        period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("march")
        .year(2022)
        .date(25)
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .month("december")
        .date(25)
        .hour(8)
        .seconds(0);

      nextExpiry = await lifecycle.getNextExpiryForPeriod(
        previousExpiry.unix(),
        period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .month("december")
        .year(2020)
        .date(27)
        .hour(8)
        .seconds(0);

      for (let i = 0; i < 7; i++) {
        time.increase(SECONDS_PER_DAY);

        nextExpiry = await lifecycle.getNextExpiryForPeriod(
          previousExpiry.unix(),
          period
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
      let nextExpiry: number;
      let nextExpiryDate: moment.Moment;

      let correctExpiryDate = moment(currentTime)
        .month("june")
        .year(2021)
        .date(25)
        .hour(8)
        .seconds(0);

      const previousExpiryTime = moment.unix(
        timestamp - period * SECONDS_PER_DAY
      );
      let previousExpiry = moment(previousExpiryTime)
        .month("december")
        .year(2020)
        .date(27)
        .hour(8)
        .seconds(0);

      nextExpiry = await lifecycle.getNextExpiryForPeriod(
        previousExpiry.unix(),
        period
      );

      nextExpiryDate = moment.unix(nextExpiry);

      assert.equal(nextExpiryDate.weekday(), weekday);
      assert.isTrue(nextExpiryDate.isSame(correctExpiryDate));
    });
  });

  describe("getNextExpiry", () => {
    const wednesdayNum = 3;
    const fridayNum = 5;
    const saturdayNum = 6;
    const sundayNum = 7;
    time.revertToSnapshotAfterEach(async () => {
      const { timestamp } = await provider.getBlock("latest");

      const now = moment.unix(timestamp);

      const startDate = moment(now).startOf("isoWeek").add(1, "week").hour(9); // needs to be 8am UTC

      await time.increaseTo(startDate.unix()); // May 31, 2021
    });

    it("Gets the correct Friday expiry for period 7 when no options written in previous period if called 7 days before", async () => {
      const fridayNum = 5;
      const period = 7;
      const { timestamp } = await provider.getBlock("latest");
      const referenceTime = moment.unix(timestamp); // Mon Nov 01 2021 09:00:00

      // We assume a scenario where we already minted options that expire at the end of the current period
      // Based on our referenceTime, Fri Nov 05 2021 08:00:00 is the current options expiry
      const currOptionExpiry = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8);

      // Previously, we would need to roll within 1 period of expiry (anytime from Fri Nov 05 2021 08:00:01 to Fri Nov 12 2021 07:59:00)
      // Another full period goes by without activity. Thus we need to simulate a time at Fri Nov 19 2021 08:00:00
      const startDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(2, "weeks"); // Fri Nov 19 2021 08:00:00
      await time.increaseTo(startDate.unix());

      // The correct expiry would be the nearest period from the current time
      const correctExpiryDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(3, "weeks"); // Fri Nov 26 2021 08:00:00

      const calculatedExpiry = await lifecycle.getNextExpiry(
        currOptionExpiry.unix(),
        period
      );
      const calculatedExpiryDate = moment.unix(calculatedExpiry);

      assert.equal(calculatedExpiryDate.weekday(), fridayNum);
      assert.isTrue(calculatedExpiryDate.isSame(correctExpiryDate));
    });

    it("Gets the correct Friday expiry for period 14 when no options written in previous period if called 14 days before", async () => {
      const period = 14;
      const { timestamp } = await provider.getBlock("latest");
      const referenceTime = moment.unix(timestamp); // Mon Nov 01 2021 09:00:00

      // We assume a scenario where we already minted options that expire at the end of the current period
      // Based on our referenceTime, Fri Nov 05 2021 08:00:00 is the current options expiry
      const currOptionExpiry = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8);

      // Previously, we would need to roll within 1 period of expiry (anytime from Fri Nov 05 2021 08:00:01 to Fri Nov 19 2021 07:59:00)
      // Another full period goes by without activity. Thus we need to simulate a time at Wed Feb 02 2022 08:00:00
      const startDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(5, "weeks"); // Fri Dec 10 2021 08:00:00
      await time.increaseTo(startDate.unix());

      const correctExpiryDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(7, "weeks"); // Fri Dec 24 2021 08:00:00

      const calculatedExpiry = await lifecycle.getNextExpiry(
        currOptionExpiry.unix(),
        period
      );
      const calculatedExpiryDate = moment.unix(calculatedExpiry);

      assert.equal(calculatedExpiryDate.weekday(), fridayNum);
      assert.isTrue(calculatedExpiryDate.isSame(correctExpiryDate));
    });

    it("Gets the correct Friday expiry for period 30 when no options written in previous period if called 30 days before", async () => {
      const period = 30;
      const { timestamp } = await provider.getBlock("latest");
      const referenceTime = moment.unix(timestamp); // Mon Nov 01 2021 09:00:00

      // We assume a scenario where we already minted options that expire at the end of the current period
      // Based on our referenceTime, Fri Nov 26 2021 08:00:00 is the current options expiry
      const currOptionExpiry = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(3, "weeks");

      // Previously, we would need to roll within 1 period of expiry (anytime from Fri Nov 26 2021 08:00:01 to Fri Dec 31 2021 07:59:00)
      // Another full period goes by without activity. Thus we need to simulate a time at Wed Feb 02 2022 08:00:00
      const startDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(wednesdayNum) // 30 days before the desired Friday expiry it's a Wednesday and not a Friday
        .hour(8)
        .add(13, "weeks"); // Wed Feb 02 2022 08:00:00
      await time.increaseTo(startDate.unix());

      const correctExpiryDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(17, "weeks"); // Fri Mar 04 2022 08:00:00

      const calculatedExpiry = await lifecycle.getNextExpiry(
        currOptionExpiry.unix(),
        period
      );
      const calculatedExpiryDate = moment.unix(calculatedExpiry);

      assert.equal(calculatedExpiryDate.weekday(), fridayNum);
      assert.isTrue(calculatedExpiryDate.isSame(correctExpiryDate));
    });

    it("Gets the correct Friday expiry for period 90 when no options written in previous period if called 90 days before", async () => {
      const period = 90;
      const { timestamp } = await provider.getBlock("latest");
      const referenceTime = moment.unix(timestamp); // Mon Nov 01 2021 09:00:00

      // We assume a scenario where we already minted options that expire at the end of the current period
      // Based on our referenceTime, Fri Dec 31 2021 08:00:00 is the current options expiry
      const currOptionExpiry = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(8, "weeks");

      // Previously, we would need to roll within 1 period of expiry (anytime from Fri Dec 31 2021 08:00:01 to Fri Mar 25 2022 07:59:00)
      // Another full period goes by without activity. Thus we need to simulate a time at Sat Jun 18 2022 08:00:00
      const startDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(saturdayNum) // 90 days before the desired Friday expiry it's a Saturday and not a Friday
        .hour(8)
        .add(32, "weeks"); // Sat Jun 18 2022 08:00:00
      await time.increaseTo(startDate.unix());

      const correctExpiryDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(45, "weeks"); // Fri Sep 16 2022 08:00:00

      const calculatedExpiry = await lifecycle.getNextExpiry(
        currOptionExpiry.unix(),
        period
      );
      const calculatedExpiryDate = moment.unix(calculatedExpiry);

      assert.equal(calculatedExpiryDate.weekday(), fridayNum);
      assert.isTrue(calculatedExpiryDate.isSame(correctExpiryDate));
    });

    it("Gets the correct Friday expiry for period 180 when no options written in previous period 180 days before", async () => {
      const period = 180;
      const { timestamp } = await provider.getBlock("latest");
      const referenceTime = moment.unix(timestamp); // Mon Nov 01 2021 09:00:00

      // We assume a scenario where we already minted options that expire at the end of the current period
      // Based on our referenceTime, Fri Dec 31 2021 08:00:00 is the current options expiry
      const currOptionExpiry = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(8, "weeks");

      // Previously, we would need to roll within 1 period of expiry (anytime from Fri Dec 31 2021 08:00:01 to Fri Jun 24 2022 07:59:00)
      // Another full period goes by without activity. Thus we need to simulate a time after Sun Jan 01 2023 08:00:00
      const startDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(sundayNum) // 180 days before the desired Friday expiry it's a Sunday and not a Friday
        .hour(8)
        .add(60, "weeks"); // Sun Jan 01 2023 08:00:00
      await time.increaseTo(startDate.unix());

      const correctExpiryDate = moment(referenceTime)
        .startOf("isoWeek")
        .day(fridayNum)
        .hour(8)
        .add(86, "weeks"); // Fri Jun 30 2023 08:00:00

      const calculatedExpiry = await lifecycle.getNextExpiry(
        currOptionExpiry.unix(),
        period
      );
      const calculatedExpiryDate = moment.unix(calculatedExpiry);

      assert.equal(calculatedExpiryDate.weekday(), fridayNum);
      assert.isTrue(calculatedExpiryDate.isSame(correctExpiryDate));
    });
  });
});
