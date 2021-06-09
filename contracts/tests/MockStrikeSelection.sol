// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

contract MockStrikeSelection {
    uint256 private _strikePrice;

    function getStrikePrice(uint256 expiryTimestamp, bool isPut)
        external
        view
        returns (uint256)
    {
        return _strikePrice;
    }

    function setStrikePrice(uint256 strikePrice) external {
        _strikePrice = strikePrice;
    }
}
