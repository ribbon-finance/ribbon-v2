// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IRETH} from "../interfaces/IRETH.sol";
import {IRETHDepositPool} from "../interfaces/IRETHDepositPool.sol";
import {IRibbonVault} from "../interfaces/IRibbon.sol";

contract RETHDepositHelper {
    IRETH public immutable rETH;
    IRETHDepositPool public immutable depositPool;
    IRibbonVault public immutable rETHVault;

    constructor(
        address _rETH,
        address _depositPool,
        address _rETHVault
    ) {
        require(_rETH != address(0), "!rETH");
        require(_depositPool != address(0), "!depositPool");
        require(_rETHVault != address(0), "!rETHVault");

        rETH = IRETH(_rETH);
        depositPool = IRETHDepositPool(_depositPool);
        rETHVault = IRibbonVault(_rETHVault);
    }

    function deposit() external payable {
        uint256 rETHAmount = depositPool.deposit{value: msg.value}();
        rETH.approve(address(rETHVault), rETHAmount);
        rETHVault.depositFor(rETHAmount, msg.sender);
    }
}
