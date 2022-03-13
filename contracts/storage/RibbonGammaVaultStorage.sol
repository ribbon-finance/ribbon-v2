// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract RibbonGammaVaultStorageV1 {
    // Amount locked for scheduled withdrawals last week;
    uint256 public lastQueuedWithdrawAmount;
    // Path for swapping usdc to weth
    bytes public usdcSwapPath;
    // Path for swapping sqth to weth
    bytes public sqthSwapPath;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonGammaVaultStorage
// e.g. RibbonGammaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonGammaVaultStorage is RibbonGammaVaultStorageV1, RibbonGammaVaultStorageV2
abstract contract RibbonGammaVaultStorage is RibbonGammaVaultStorageV1 {

}
