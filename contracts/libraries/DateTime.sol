// SPDX-License-Identifier: MIT
// Source: https://github.com/pipermerriam/ethereum-datetime/blob/master/contracts/DateTime.sol

pragma solidity =0.8.4;

library DateTime {
    uint256 constant DAY_IN_SECONDS = 86400;
    uint256 constant YEAR_IN_SECONDS = 31536000;
    uint256 constant LEAP_YEAR_IN_SECONDS = 31622400;

    uint256 constant HOUR_IN_SECONDS = 3600;
    uint256 constant MINUTE_IN_SECONDS = 60;

    uint16 constant ORIGIN_YEAR = 1970;

    function isLeapYear(uint16 year) internal pure returns (bool) {
        if (year % 4 != 0) {
            return false;
        }
        if (year % 100 != 0) {
            return true;
        }
        if (year % 400 != 0) {
            return false;
        }
        return true;
    }

    function leapYearsBefore(uint256 year) internal pure returns (uint256) {
        year -= 1;
        return year / 4 - year / 100 + year / 400;
    }

    function getDaysInMonth(uint8 month, uint16 year)
        internal
        pure
        returns (uint8)
    {
        if (
            month == 1 ||
            month == 3 ||
            month == 5 ||
            month == 7 ||
            month == 8 ||
            month == 10 ||
            month == 12
        ) {
            return 31;
        } else if (month == 4 || month == 6 || month == 9 || month == 11) {
            return 30;
        } else if (isLeapYear(year)) {
            return 29;
        } else {
            return 28;
        }
    }

    function getYear(uint256 timestamp) internal pure returns (uint16) {
        uint256 secondsAccountedFor = 0;
        uint16 year;
        uint256 numLeapYears;

        // Year
        year = uint16(ORIGIN_YEAR + timestamp / YEAR_IN_SECONDS);
        numLeapYears = leapYearsBefore(year) - leapYearsBefore(ORIGIN_YEAR);

        secondsAccountedFor += LEAP_YEAR_IN_SECONDS * numLeapYears;
        secondsAccountedFor +=
            YEAR_IN_SECONDS *
            (year - ORIGIN_YEAR - numLeapYears);

        while (secondsAccountedFor > timestamp) {
            if (isLeapYear(uint16(year - 1))) {
                secondsAccountedFor -= LEAP_YEAR_IN_SECONDS;
            } else {
                secondsAccountedFor -= YEAR_IN_SECONDS;
            }
            year -= 1;
        }
        return year;
    }

    function getWeekday(uint256 timestamp) internal pure returns (uint256) {
        return uint256((timestamp / DAY_IN_SECONDS + 4) % 7);
    }

    /**
     * @notice Gets the last weekday of the month
     * @param timestamp is the timestamp from which the last weekday will be calculated
     * @param weekday is the weekday (0 for Sunday - 6 for Saturday)
     * Example:
     * getLastWeekdayOfMonth(11 June 2021, 5) -> Friday, 25 June 2021
     */
    function getLastWeekdayOfMonth(uint256 timestamp, uint256 weekday)
        internal
        pure
        returns (uint256 nextMonthExpiry)
    {
        uint256 secondsAccountedFor = 0;
        uint256 buf;
        uint8 i;
        uint8 month;
        uint256 day;

        // Year
        uint16 year = getYear(timestamp);
        buf = leapYearsBefore(year) - leapYearsBefore(ORIGIN_YEAR);

        secondsAccountedFor += LEAP_YEAR_IN_SECONDS * buf;
        secondsAccountedFor += YEAR_IN_SECONDS * (year - ORIGIN_YEAR - buf);

        // Month
        uint256 secondsInMonth;
        for (i = 1; i <= 12; i++) {
            secondsInMonth = DAY_IN_SECONDS * getDaysInMonth(i, year);
            if (secondsInMonth + secondsAccountedFor > timestamp) {
                month = i;
                break;
            }
            secondsAccountedFor += secondsInMonth;
        }

        // Day
        for (i = 1; i <= getDaysInMonth(month, year); i++) {
            if (DAY_IN_SECONDS + secondsAccountedFor > timestamp) {
                day = i;
                break;
            }
            secondsAccountedFor += DAY_IN_SECONDS;
        }

        // Get the last day of the month
        nextMonthExpiry =
            timestamp +
            (getDaysInMonth(month, year) - day) *
            1 days;

        uint256 expiryWeekday =
            getWeekday(nextMonthExpiry) == 0 ? 7 : getWeekday(nextMonthExpiry);
        
        weekday = weekday == 0 ? 7 : weekday;

        nextMonthExpiry -= expiryWeekday >= weekday
            ? (expiryWeekday - weekday) * 1 days
            : 7 days - (weekday - expiryWeekday) * 1 days;
    }
}
