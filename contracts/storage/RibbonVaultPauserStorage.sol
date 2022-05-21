// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract RibbonVaultPauserStorageV1 {
    
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonVaultPauserStorage
// e.g. RibbonVaultPauserStorage<versionNumber>, so finally it would look like
// contract RibbonVaultPauserStorage is RibbonVaultPauserStorageV1, RibbonVaultPauserStorageV2
abstract contract RibbonVaultPauserStorage is
    RibbonVaultPauserStorageV1,
{

}