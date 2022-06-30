// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {ICurveETHSTETHPool} from "../interfaces/ICurveETHSTETHPool.sol";
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract STETHDepositHelper {
    using SafeERC20 for IERC20;

    ICurveETHSTETHPool public immutable curveETHSTETHPool;
    IRibbonThetaVault public immutable stETHVault;
    IERC20 public immutable stETH;

    constructor(
        address _curveETHSTETHPool,
        address _stETHVault,
        address _stETH
    ) {
        require(_curveETHSTETHPool != address(0), "!curveETHSTETH Pool");
        require(_stETHVault != address(0), "!stETHVault");
        require(_stETH != address(0), "!_stETH");

        curveETHSTETHPool = ICurveETHSTETHPool(_curveETHSTETHPool);
        stETHVault = IRibbonThetaVault(_stETHVault);
        stETH = IERC20(_stETH);
    }

    /**
     * Swaps ETH -> stETH on Curve ETH-stETH pool, and deposits into stETH vault
     */
    function deposit(uint256 minSTETHAmount) external payable {
        curveETHSTETHPool.exchange{value: msg.value}(
            0,
            1,
            msg.value,
            minSTETHAmount
        );
        uint256 balance = stETH.balanceOf(address(this));
        stETH.safeApprove(address(stETHVault), balance);
        stETHVault.depositYieldTokenFor(balance, msg.sender);
    }
}
