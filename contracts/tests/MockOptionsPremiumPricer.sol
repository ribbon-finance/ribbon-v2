// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

contract MockOptionsPremiumPricer {
    uint256 private _optionPremiumPrice;
    uint256 private _optionUnderlyingPrice;
    uint256 private _optionUSDCPrice;
    address private _priceOracle;
    address private _volatilityOracle;
    address private _pool;
    mapping(uint256 => uint256) private _deltas;

    function getPremium(
        uint256,
        uint256,
        bool
    ) external view returns (uint256) {
        return _optionPremiumPrice;
    }

    function getOptionDelta(uint256 strikePrice, uint256)
        external
        view
        returns (uint256)
    {
        return _deltas[strikePrice];
    }

    function getOptionDelta(
        uint256,
        uint256 strikePrice,
        uint256,
        uint256
    ) external view returns (uint256) {
        return _deltas[strikePrice];
    }

    function pool() external view returns (address) {
        return _pool;
    }

    function getUnderlyingPrice() external view returns (uint256) {
        return _optionUnderlyingPrice;
    }

    function priceOracle() external view returns (address) {
        return _priceOracle;
    }

    function volatilityOracle() external view returns (address) {
        return _volatilityOracle;
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

    function setPriceOracle(address oracle) external {
        _priceOracle = oracle;
    }

    function setPool(address p) external {
        _pool = p;
    }

    function setVolatilityOracle(address oracle) external returns (address) {
        _volatilityOracle = oracle;
    }
}
