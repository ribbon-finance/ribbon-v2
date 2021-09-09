pragma solidity ^0.7.2;

interface IOracle {
    function setAssetPricer(address _asset, address _pricer) external;
}
