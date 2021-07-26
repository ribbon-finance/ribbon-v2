// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;

import {IYearnVault} from "../interfaces/IYearn.sol";
import {
    OptionsVaultStorageV1,
    OptionsThetaVaultStorageV1,
    OptionsDeltaVaultStorageV1
} from "./OptionsVaultStorage.sol";

abstract contract OptionsThetaYearnVaultStorageV1 is
    OptionsThetaVaultStorageV1
{}

abstract contract OptionsVaultYearnStorageV1 is OptionsVaultStorageV1 {
    // Yearn vault contract
    IYearnVault public collateralToken;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of OptionsVaultStorage
// e.g. OptionsVaultStorageV<versionNumber>, so finally it would look like
// contract OptionsVaultStorage is OptionsVaultStorageV1, OptionsVaultStorageV2
abstract contract OptionsVaultYearnStorage is OptionsVaultYearnStorageV1 {

}

abstract contract OptionsThetaYearnVaultStorage is
    OptionsThetaYearnVaultStorageV1
{}
