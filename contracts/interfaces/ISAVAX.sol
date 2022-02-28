// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ISAVAX is IERC20 {
    function getSharesByPooledAvax(uint256 avaxAmount)
        external
        view
        returns (uint256);

    function getPooledAvaxByShares(uint256 shareAmount)
        external
        view
        returns (uint256);

    function submit() external payable returns (uint256);
}
