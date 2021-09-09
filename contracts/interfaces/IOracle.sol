// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IOracle {
    function setAssetPricer(address _asset, address _pricer) external;
}
