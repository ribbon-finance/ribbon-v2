// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

contract MockOptionsPremiumPricer {
    uint256 private _optionPremiumPrice;

    function getPremium(
        uint256 strikePrice,
        uint256 expiryTimestamp,
        bool isPut
    ) external view returns (uint256) {
        return _optionPremiumPrice;
    }

    function setPremium(uint256 premium) external {
        _optionPremiumPrice = premium;
    }
}
