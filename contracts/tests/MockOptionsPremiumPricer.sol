// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

contract MockOptionsPremiumPricer {
    uint256 private _optionPremiumPrice;
    uint256 private _optionUnderlyingPrice;
    uint256 private _optionUSDCPrice;
    address private _priceOracle;
    address private _volatilityOracle;
    bytes32 private _optionId;
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

    function optionId() external view returns (bytes32) {
        return _optionId;
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

    function setOptionId(bytes32 newOptionId) external {
        _optionId = newOptionId;
    }

    function setVolatilityOracle(address oracle) external {
        _volatilityOracle = oracle;
    }
}
