// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IERC20Detailed is IERC20 {
    function decimals() external view returns (uint8);

    function symbol() external view returns (string calldata);

    function name() external view returns (string calldata);
}
