// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IRETH is IERC20 {
    function getExchangeRate() external view returns (uint256);

    function getETHValue(uint256 rethAmount) external view returns (uint256);

    function getRethValue(uint256 ethAmount) external view returns (uint256);
}
