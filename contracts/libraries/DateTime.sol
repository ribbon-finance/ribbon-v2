// SPDX-License-Identifier: MIT
// Source: https://github.com/bokkypoobah/BokkyPooBahsDateTimeLibrary
// ----------------------------------------------------------------------------
// BokkyPooBah's DateTime Library v1.01
// ----------------------------------------------------------------------------

pragma solidity =0.8.4;

library DateTime {
    uint256 constant SECONDS_PER_DAY = 24 * 60 * 60;
    uint256 constant SECONDS_PER_HOUR = 60 * 60;
    uint256 constant SECONDS_PER_MINUTE = 60;
    int256 constant OFFSET19700101 = 2440588;

    uint256 constant DOW_MON = 1;
    uint256 constant DOW_TUE = 2;
    uint256 constant DOW_WED = 3;
    uint256 constant DOW_THU = 4;
    uint256 constant DOW_FRI = 5;
    uint256 constant DOW_SAT = 6;
    uint256 constant DOW_SUN = 7;

    // ------------------------------------------------------------------------
    // Calculate the number of days from 1970/01/01 to year/month/day using
    // the date conversion algorithm from
    //   http://aa.usno.navy.mil/faq/docs/JD_Formula.php
    // and subtracting the offset 2440588 so that 1970/01/01 is day 0
    //
    // days = day
    //      - 32075
    //      + 1461 * (year + 4800 + (month - 14) / 12) / 4
    //      + 367 * (month - 2 - (month - 14) / 12 * 12) / 12
    //      - 3 * ((year + 4900 + (month - 14) / 12) / 100) / 4
    //      - offset
    // ------------------------------------------------------------------------
    function _daysFromDate(
        uint256 year,
        uint256 month,
        uint256 day
    ) internal pure returns (uint256 _days) {
        require(year >= 1970);
        int256 _year = int256(year);
        int256 _month = int256(month);
        int256 _day = int256(day);

        int256 __days =
            _day -
                32075 +
                (1461 * (_year + 4800 + (_month - 14) / 12)) /
                4 +
                (367 * (_month - 2 - ((_month - 14) / 12) * 12)) /
                12 -
                (3 * ((_year + 4900 + (_month - 14) / 12) / 100)) /
                4 -
                OFFSET19700101;

        _days = uint256(__days);
    }

    // ------------------------------------------------------------------------
    // Calculate year/month/day from the number of days since 1970/01/01 using
    // the date conversion algorithm from
    //   http://aa.usno.navy.mil/faq/docs/JD_Formula.php
    // and adding the offset 2440588 so that 1970/01/01 is day 0
    //
    // int L = days + 68569 + offset
    // int N = 4 * L / 146097
    // L = L - (146097 * N + 3) / 4
    // year = 4000 * (L + 1) / 1461001
    // L = L - 1461 * year / 4 + 31
    // month = 80 * L / 2447
    // dd = L - 2447 * month / 80
    // L = month / 11
    // month = month + 2 - 12 * L
    // year = 100 * (N - 49) + year + L
    // ------------------------------------------------------------------------
    function _daysToDate(uint256 _days)
        internal
        pure
        returns (
            uint256 year,
            uint256 month,
            uint256 day
        )
    {
        int256 __days = int256(_days);

        int256 L = __days + 68569 + OFFSET19700101;
        int256 N = (4 * L) / 146097;
        L = L - (146097 * N + 3) / 4;
        int256 _year = (4000 * (L + 1)) / 1461001;
        L = L - (1461 * _year) / 4 + 31;
        int256 _month = (80 * L) / 2447;
        int256 _day = L - (2447 * _month) / 80;
        L = _month / 11;
        _month = _month + 2 - 12 * L;
        _year = 100 * (N - 49) + _year + L;

        year = uint256(_year);
        month = uint256(_month);
        day = uint256(_day);
    }

    function isLeapYear(uint256 timestamp)
        internal
        pure
        returns (bool leapYear)
    {
        (uint256 year, , ) = _daysToDate(timestamp / SECONDS_PER_DAY);
        leapYear = _isLeapYear(year);
    }

    function _isLeapYear(uint256 year) internal pure returns (bool leapYear) {
        leapYear = ((year % 4 == 0) && (year % 100 != 0)) || (year % 400 == 0);
    }

    function getDaysInMonth(uint256 timestamp)
        internal
        pure
        returns (uint256 daysInMonth)
    {
        (uint256 year, uint256 month, ) =
            _daysToDate(timestamp / SECONDS_PER_DAY);
        daysInMonth = _getDaysInMonth(year, month);
    }

    function _getDaysInMonth(uint256 year, uint256 month)
        internal
        pure
        returns (uint256 daysInMonth)
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
            daysInMonth = 31;
        } else if (month != 2) {
            daysInMonth = 30;
        } else {
            daysInMonth = _isLeapYear(year) ? 29 : 28;
        }
    }

    // 1 = Monday, 7 = Sunday
    function getDayOfWeek(uint256 timestamp)
        internal
        pure
        returns (uint256 dayOfWeek)
    {
        uint256 _days = timestamp / SECONDS_PER_DAY;
        dayOfWeek = ((_days + 3) % 7) + 1;
    }

    function getYear(uint256 timestamp) internal pure returns (uint256 year) {
        (year, , ) = _daysToDate(timestamp / SECONDS_PER_DAY);
    }

    function getMonth(uint256 timestamp) internal pure returns (uint256 month) {
        (, month, ) = _daysToDate(timestamp / SECONDS_PER_DAY);
    }

    function getDay(uint256 timestamp) internal pure returns (uint256 day) {
        (, , day) = _daysToDate(timestamp / SECONDS_PER_DAY);
    }

    function timestampFromDate(
        uint256 year,
        uint256 month,
        uint256 day
    ) internal pure returns (uint256 timestamp) {
        timestamp = _daysFromDate(year, month, day) * SECONDS_PER_DAY;
    }

    /**
     * @notice Gets the Friday of the same week
     * @param timestamp is the given date and time
     * @return the Friday of the same week in unix time
     */
    function getThisWeekFriday(uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        return timestamp + 5 days - getDayOfWeek(timestamp) * 1 days;
    }

    /**
     * @notice Gets the next friday after the given date and time
     * @param timestamp is the given date and time
     * @return the next friday after the given date and time
     */
    function getNextFriday(uint256 timestamp) internal pure returns (uint256) {
        uint256 friday = getThisWeekFriday(timestamp);
        return friday >= timestamp ? friday : friday + 1 weeks;
    }

    /**
     * @notice Gets the last day of the month
     * @param timestamp is the given date and time
     * @return the last day of the same month in unix time
     */
    function getLastDayOfMonth(uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        return
            timestampFromDate(getYear(timestamp), getMonth(timestamp) + 1, 1) -
            1 days;
    }

    /**
     * @notice Gets the last Friday of the month
     * @param timestamp is the given date and time
     * @return the last Friday of the same month in unix time
     */
    function getMonthLastFriday(uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        uint256 lastDay = getLastDayOfMonth(timestamp);
        uint256 friday = getThisWeekFriday(lastDay);

        return friday > lastDay ? friday - 1 weeks : friday;
    }

    /**
     * @notice Gets the last Friday of the quarter
     * @param timestamp is the given date and time
     * @return the last Friday of the quarter in unix time
     */
    function getQuarterLastFriday(uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        uint256 month = getMonth(timestamp);
        uint256 quarterMonth =
            (month <= 3) ? 3 : (month <= 6) ? 6 : (month <= 9) ? 9 : 12;

        uint256 quarterDate =
            timestampFromDate(getYear(timestamp), quarterMonth, 1);

        return getMonthLastFriday(quarterDate);
    }

    /**
     * @notice Gets the last Friday of the half-year
     * @param timestamp is the given date and time
     * @return the last friday of the half-year
     */
    function getBiannualLastFriday(uint256 timestamp)
        internal
        pure
        returns (uint256)
    {
        uint256 month = getMonth(timestamp);
        uint256 biannualMonth = (month <= 6) ? 6 : 12;

        uint256 biannualDate =
            timestampFromDate(getYear(timestamp), biannualMonth, 1);

        return getMonthLastFriday(biannualDate);
    }
}
