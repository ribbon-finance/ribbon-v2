// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {
    RibbonTreasuryVaultLiteStorage
} from "./RibbonTreasuryVaultLiteStorage.sol";

abstract contract RibbonTreasuryVaultStorageV1 is
    RibbonTreasuryVaultLiteStorage
{
    /// @notice Mapping of depositors in the vault
    mapping(address => bool) public depositorsMap;

    /// @notice Array of depositors in the vault
    address[] public depositorsArray;

    /// @notice Current oToken premium
    uint256 public currentOtokenPremium;

    /// @notice Auction duration
    uint256 public auctionDuration;

    /// @notice Auction id of current option
    uint256 public optionAuctionID;

    /// @notice Maximum number of depositors
    uint256 public maxDepositors;

    /// @notice Minimum amount to deposit
    uint256 public minDeposit;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonTreasuryVaultStorage
// e.g. RibbonTreasuryVaultStorage<versionNumber>, so finally it would look like
// contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1, RibbonTreasuryVaultStorageV2
abstract contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1 {

}
