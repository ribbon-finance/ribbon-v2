// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

contract MockVolatilityOracle {
    uint256 private _annualizedVol;

    function annualizedVol(address) external view returns (uint256) {
        return _annualizedVol;
    }

    function setAnnualizedVol(uint256 vol) external {
        _annualizedVol = vol;
    }
}
