// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

interface IStrikeSelection {
    function getStrikePrice() external view returns (uint256);
}
