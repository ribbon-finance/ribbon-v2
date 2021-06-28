// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

contract MockVolatilityOracle {
    uint256 private _annualizedVol;
    address private _pool;

    function annualizedVol(address pool) external view returns (uint256) {
        return _annualizedVol;
    }

    function pool() external view returns (address) {
        return _pool;
    }

    function setPool(address pool) external {
        _pool = pool;
    }

    function setAnnualizedVol(uint256 vol) external {
        _annualizedVol = vol;
    }
}
