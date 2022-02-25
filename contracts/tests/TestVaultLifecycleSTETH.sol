// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {ISTETH, IWSTETH} from "../interfaces/ISTETH.sol";
import {VaultLifecycleSTETH} from "../libraries/VaultLifecycleSTETH.sol";

contract TestVaultLifecycleSTETH {
    address constant wstETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant crvPool = 0xDC24316b9AE028F1497c275EB9192a3Ea0f67022;

    // To avoid using events to get the output, we just set it so we can read
    // it off the contract
    uint256 public output;

    function unwrapYieldToken(uint256 amount, uint256 minETHOut) external {
        uint256 amountETHOut =
            VaultLifecycleSTETH.unwrapYieldToken(
                amount,
                wstETH,
                IWSTETH(wstETH).stETH(),
                crvPool,
                minETHOut
            );
        output = amountETHOut;
    }

    function withdrawStEth(uint256 amount) external {
        address steth = IWSTETH(wstETH).stETH();
        uint256 amountETHOut =
            VaultLifecycleSTETH.withdrawStEth(steth, wstETH, amount);
        output = amountETHOut;
        ISTETH(steth).transfer(msg.sender, amountETHOut);
    }

    // Enables test to send ETH for testing
    receive() external payable {}
}
