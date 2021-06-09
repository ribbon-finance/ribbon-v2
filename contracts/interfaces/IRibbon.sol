// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

interface IStrikeSelection {
    function getStrikePrice(uint256 expiryTimestamp, bool isPut)
        external
        view
        returns (uint256);
}

interface IOptionsPremiumPricer {
    function getPremium(
        uint256 strikePrice,
        uint256 expiryTimestamp,
        bool isPut
    ) external view returns (uint256);
}
