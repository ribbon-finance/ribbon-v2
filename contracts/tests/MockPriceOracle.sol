// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

contract MockPriceOracle {
    uint256 private _decimals;

    function setDecimals(uint256 decimals) external {
        _decimals = decimals;
    }

    function decimals() external view returns (uint256) {
        return _decimals;
    }
}
