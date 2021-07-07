// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

contract MockStrikeSelection {
    uint256 private _strikePrice;
    uint256 private _delta;

    function getStrikePrice(uint256, bool)
        external
        view
        returns (uint256, uint256)
    {
        return (_strikePrice, _delta);
    }

    function setStrikePrice(uint256 strikePrice) external {
        _strikePrice = strikePrice;
    }

    function setDelta(uint256 delta) external {
        _delta = delta;
    }

    function delta() external view returns (uint256) {
        return _delta;
    }
}
