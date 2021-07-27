// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

library SupportsNonCompliantERC20 {
    address constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;

    function safeApprove(
        IERC20 token,
        address spender,
        uint256 amount
    ) internal {
        if (address(token) == USDT) {
            SafeERC20.safeApprove(token, spender, 0);
        }
        SafeERC20.safeApprove(token, spender, amount);
    }
}
