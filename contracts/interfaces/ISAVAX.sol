// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

interface ISAVAX {
    function getSharesByPooledAvax(uint256 avaxAmount)
        external
        view
        returns (uint256);

    function getPooledAvaxByShares(uint256 shareAmount)
        external
        view
        returns (uint256);

    function decimals() external view returns (uint256 _decimals);
}
