// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;

import {IWSTETH} from "../interfaces/ISTETH.sol";
import {
    OptionsVaultStorageV1,
    OptionsThetaVaultStorageV1,
    OptionsDeltaVaultStorageV1
} from "./OptionsVaultStorage.sol";

abstract contract OptionsThetaSTETHVaultStorageV1 is
    OptionsThetaVaultStorageV1
{}

abstract contract OptionsVaultSTETHStorageV1 is OptionsVaultStorageV1 {
    // wstETH vault contract
    IWSTETH public collateralToken;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of OptionsVaultStorage
// e.g. OptionsVaultStorageV<versionNumber>, so finally it would look like
// contract OptionsVaultStorage is OptionsVaultStorageV1, OptionsVaultStorageV2
abstract contract OptionsVaultSTETHStorage is OptionsVaultSTETHStorageV1 {

}

abstract contract OptionsThetaSTETHVaultStorage is
    OptionsThetaSTETHVaultStorageV1
{}
