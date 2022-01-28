// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {Vault} from "../libraries/Vault.sol";

abstract contract RibbonTreasuryVaultStorageV1 {
    /// @notice Vault's parameters like cap, decimals
    Vault.VaultParams public vaultParams;

    /// @notice Vault's lifecycle state like round and locked amounts
    Vault.VaultState public vaultState;

    /// @notice Vault's state of the options sold and the timelocked option
    Vault.OptionState public optionState;

    /// @notice Stores the user's pending deposit for the round
    mapping(address => Vault.DepositReceipt) public depositReceipts;

    /// @notice On every round's close, the pricePerShare value of an rTHETA token is stored
    /// This is used to determine the number of shares to be returned
    /// to a user with their DepositReceipt.depositAmount
    mapping(uint256 => uint256) public roundPricePerShare;

    /// @notice Stores pending user withdrawals
    mapping(address => Vault.Withdrawal) public withdrawals;

    /// @notice Mapping of depositors in the vault
    mapping(address => bool) public depositorsMap;

    /// @notice Array of depositors in the vault
    address[] public depositorsArray;

    /// @notice Fee recipient for the performance and management fees
    address public feeRecipient;

    /// @notice role in charge of weekly vault operations such as rollToNextOption and burnRemainingOTokens
    // no access to critical vault changes
    address public keeper;

    /// @notice Logic contract used to price options
    address public optionsPremiumPricer;

    /// @notice Logic contract used to select strike prices
    address public strikeSelection;

    /// @notice Performance fee charged on premiums earned in rollToNextOption. Only charged when there is no loss.
    uint256 public performanceFee;

    /// @notice Management fee charged on entire AUM in rollToNextOption. Only charged when there is no loss.
    uint256 public managementFee;

    /// @notice Premium discount on options we are selling (thousandths place: 000 - 999)
    uint256 public premiumDiscount;

    /// @notice Current oToken premium
    uint256 public currentOtokenPremium;

    /// @notice Price last overridden strike set to
    uint256 public overriddenStrikePrice;

    /// @notice Auction duration
    uint256 public auctionDuration;

    /// @notice Auction id of current option
    uint256 public optionAuctionID;

    /// @notice Amount locked for scheduled withdrawals last week;
    uint256 public lastQueuedWithdrawAmount;

    /// @notice Period between each options sale.
    /// Available options 7 (weekly), 14 (biweekly), 30 (monthly), 90 (quarterly), 180 (biannually)
    uint256 public period;

    /// @notice Maximum number of depositors
    uint256 public maxDepositors;

    /// @notice Last round id at which the strike was manually overridden
    uint16 public lastStrikeOverrideRound;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonTreasuryVaultStorage
// e.g. RibbonTreasuryVaultStorage<versionNumber>, so finally it would look like
// contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1, RibbonTreasuryVaultStorageV2
abstract contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1 {

}
