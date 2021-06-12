// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

contract MockOptionsPremiumPricer {
    uint256 private _optionPremiumPrice;
    uint256 private _optionUnderlyingPrice;
    mapping(uint256 => uint256) private _deltas;

    function getPremium(
        uint256 strikePrice,
        uint256 expiryTimestamp,
        bool isPut
    ) external view returns (uint256) {
        return _optionPremiumPrice;
    }

    function getOptionDelta(uint256 strikePrice, uint256 expiryTimestamp)
        external
        view
        returns (uint256)
    {
        return _deltas[strikePrice];
    }

    function getUnderlyingPrice() external view returns (uint256) {
        return _optionUnderlyingPrice;
    }

    function setPremium(uint256 premium) external {
        _optionPremiumPrice = premium;
    }

    function setOptionUnderlyingPrice(uint256 underlyingPrice) external {
        _optionUnderlyingPrice = underlyingPrice;
    }

    function setOptionDelta(uint256 strikePrice, uint256 delta) external {
        _deltas[strikePrice] = delta;
    }
}
