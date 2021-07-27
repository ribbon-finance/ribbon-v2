// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;

import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Vault} from "../libraries/Vault.sol";
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";

abstract contract OptionsVaultStorageV1 is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    ERC20Upgradeable
{
    /// @notice Stores the user's pending deposit for the round
    mapping(address => Vault.DepositReceipt) public depositReceipts;

    /// @notice On every round's close, the pricePerShare value of an rTHETA token is stored
    /// This is used to determine the number of shares to be returned
    /// to a user with their DepositReceipt.depositAmount
    mapping(uint16 => uint256) public roundPricePerShare;

    /// @notice Stores pending user withdrawals
    mapping(address => Vault.Withdrawal) public withdrawals;

    Vault.VaultParams public vaultParams;

    Vault.VaultState public vaultState;

    Vault.OptionState public optionState;

    address public feeRecipient;

    uint256 public performanceFee;

    uint256 public managementFee;
}

abstract contract OptionsThetaVaultStorageV1 {
    // Logic contract used to price options
    address public optionsPremiumPricer;
    // Logic contract used to select strike prices
    address public strikeSelection;
    // Premium discount on options we are selling (thousandths place: 000 - 999)
    uint32 public premiumDiscount;
    // Current oToken premium
    uint104 public currentOtokenPremium;
    // Last round id at which the strike was manually overridden
    uint16 public lastStrikeOverride;
    // Price last overridden strike set to
    uint128 public overriddenStrikePrice;
    // Auction duration
    uint256 public auctionDuration;
    // Auction id of current option
    uint256 public optionAuctionID;
}

abstract contract OptionsDeltaVaultStorageV1 {
    // Ribbon counterparty theta vault
    IRibbonThetaVault public counterpartyThetaVault;
    // % of funds to be used for weekly option purchase
    uint256 public optionAllocationPct;
    // Delta vault equivalent of lockedAmount
    uint104 public balanceBeforePremium;
    // User Id of delta vault in latest gnosis auction
    Vault.AuctionSellOrder public auctionSellOrder;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of OptionsVaultStorage
// e.g. OptionsVaultStorageV<versionNumber>, so finally it would look like
// contract OptionsVaultStorage is OptionsVaultStorageV1, OptionsVaultStorageV2
abstract contract OptionsVaultStorage is OptionsVaultStorageV1 {

}

abstract contract OptionsThetaVaultStorage is OptionsThetaVaultStorageV1 {}

abstract contract OptionsDeltaVaultStorage is OptionsDeltaVaultStorageV1 {}
