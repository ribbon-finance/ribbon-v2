// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOptionsPurchaseQueue} from "../interfaces/IOptionsPurchaseQueue.sol";
import {Vault} from "../libraries/Vault.sol";

contract MockRibbonVault {
    Vault.VaultParams public vaultParams;

    address public currentOption;

    function setAsset(address asset) external {
        vaultParams.asset = asset;
    }

    function setCurrentOption(address option) external {
        currentOption = option;
    }

    function allocateOptions(
        address optionsPurchaseQueue,
        address option,
        uint256 optionsAmount
    ) external {
        IERC20(option).approve(optionsPurchaseQueue, optionsAmount);
        IOptionsPurchaseQueue(optionsPurchaseQueue).allocateOptions(
            optionsAmount
        );
    }

    function sellToBuyers(address optionsPurchaseQueue, uint256 settlementPrice)
        external
    {
        IOptionsPurchaseQueue(optionsPurchaseQueue).sellToBuyers(
            settlementPrice
        );
    }
}
