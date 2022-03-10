// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IOracle {
    function setAssetPricer(address _asset, address _pricer) external;

    function setExpiryPrice(
        address _asset,
        uint256 _expiryTimestamp,
        uint256 _price
    ) external;

    function getPricer(address _asset) external view returns (address);

    function setStablePrice(address _asset, uint256 _price) external;

    function isDisputePeriodOver(address _asset, uint256 _expiryTimestamp)
        external
        view
        returns (bool);
}
