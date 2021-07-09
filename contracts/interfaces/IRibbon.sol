// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

interface IStrikeSelection {
    function getStrikePrice(uint256 expiryTimestamp, bool isPut)
        external
        view
        returns (uint256, uint256);

    function delta() external view returns (uint256);
}

interface IOptionsPremiumPricer {
    function getPremium(
        uint256 strikePrice,
        uint256 timeToExpiry,
        bool isPut
    ) external view returns (uint256);

    function getOptionDelta(
        uint256 sp,
        uint256 st,
        uint256 v,
        uint256 t
    ) external view returns (uint256 delta);

    function getUnderlyingPrice() external view returns (uint256 price);

    function priceOracle() external view returns (address oracle);

    function volatilityOracle() external view returns (address oracle);

    function pool() external view returns (address _pool);
}
