// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {Vault} from "../libraries/Vault.sol";

abstract contract RibbonGammaVaultStorageV1 {
    /// @notice Stores the user's pending deposit for the round
    mapping(address => Vault.DepositReceipt) public depositReceipts;

    /// @notice On every round's close, the pricePerShare value of an rTHETA token is stored
    /// This is used to determine the number of shares to be returned
    /// to a user with their DepositReceipt.depositAmount
    mapping(uint256 => uint256) public roundPricePerShare;

    /// @notice Stores pending user withdrawals
    mapping(address => Vault.Withdrawal) public withdrawals;

    /// @notice Vault's parameters like cap, decimals
    Vault.VaultParams public vaultParams;

    /// @notice Vault's lifecycle state like round and locked amounts
    Vault.VaultState public vaultState;

    /// @notice Fee recipient for the performance and management fees
    address public feeRecipient;

    /// @notice role in charge of weekly vault operations such as rollToNextOption and burnRemainingOTokens
    // no access to critical vault changes
    address public keeper;

    /// @notice Performance fee charged on premiums earned in rollToNextOption. Only charged when there is no loss.
    uint256 public performanceFee;

    /// @notice Management fee charged on entire AUM in rollToNextOption. Only charged when there is no loss.
    uint256 public managementFee;

    /// @notice Amount locked for scheduled withdrawals last week;
    uint256 public lastQueuedWithdrawAmount;

    /// @notice Pending deposits for rollover
    uint256 public pendingDeposits;

    /// @notice LiquidityGauge contract for the vault
    address public liquidityGauge;

    /// @notice OptionsPurchaseQueue contract for the vault
    address public optionsPurchaseQueue;

    /// @notice Ribbon ETH Call Theta Vault to buy call options from
    address public ribbonThetaCallVault;

    /// @notice Ribbon ETH Put Theta Vault to buy call options from
    address public ribbonThetaPutVault;

    /// @notice True if the vault is currently adding/withdrawing from the squeeth short position
    bool public newRoundInProgress;

    /// @notice The collateral ratio threshold at which the vault is eligible for a rebalancing
    uint256 public ratioThreshold;

    /// @notice A multiplier on the amount to allocate towards the long strangle
    uint256 public optionAllocation;

    /// @notice USDC -> WETH swap path
    bytes public usdcWethSwapPath;

    /// @notice WETH -> USDC swap path
    bytes public wethUsdcSwapPath;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonGammaVaultStorage
// e.g. RibbonGammaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonGammaVaultStorage is RibbonGammaVaultStorageV1, RibbonGammaVaultStorageV2
abstract contract RibbonGammaVaultStorage is RibbonGammaVaultStorageV1 {

}
