// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";
import {Vault} from "../libraries/Vault.sol";

abstract contract RibbonDeltaVaultStorageV1 {
    // Ribbon counterparty theta vault
    IRibbonThetaVault public counterpartyThetaVault;
    // % of funds to be used for weekly option purchase
    uint256 public optionAllocation;
    // Delta vault equivalent of lockedAmount
    uint256 public balanceBeforePremium;
    // User Id of delta vault in latest gnosis auction
    Vault.AuctionSellOrder public auctionSellOrder;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonDeltaVaultStorage
// e.g. RibbonDeltaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonDeltaVaultStorage is RibbonDeltaVaultStorageV1, RibbonDeltaVaultStorageV2
abstract contract RibbonDeltaVaultStorage is RibbonDeltaVaultStorageV1 {

}
