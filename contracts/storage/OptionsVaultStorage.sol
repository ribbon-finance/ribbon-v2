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
import {VaultDeposit} from "../libraries/VaultDeposit.sol";
import {StrikeOverride} from "../libraries/StrikeOverride.sol";

contract OptionsVaultStorageV1 is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    ERC20Upgradeable
{
    // DEPRECATED: This variable was originally used to store the asset address we are using as collateral
    // But due to gas optimization and upgradeability security concerns,
    // we removed it in favor of using immutable variables
    // This variable is left here to hold the storage slot for upgrades
    address private _oldAsset;

    // Privileged role that is able to select the option terms (strike price, expiry) to short
    address private _manager;

    // Option that the vault is shorting in the next cycle
    address public nextOption;

    // The timestamp when the `nextOption` can be used by the vault
    uint256 public nextOptionReadyAt;

    // Option that the vault is currently shorting
    address public currentOption;

    // Amount that is currently locked for selling options
    uint256 public lockedAmount;

    // Cap for total amount deposited into vault
    uint256 public cap;

    // Fee incurred when withdrawing out of the vault, in the units of 10**18
    // where 1 ether = 100%, so 0.005 means 0.5% fee
    uint256 private _instantWithdrawalFee;

    // Recipient for withdrawal fees
    address public feeRecipient;
}

contract OptionsVaultStorageV2 {
    // Amount locked for scheduled withdrawals;
    uint256 public queuedWithdrawShares;

    // Mapping to store the scheduled withdrawals (address => withdrawAmount)
    mapping(address => uint256) public scheduledWithdrawals;
}

contract OptionsVaultStorageV3 {
    /// @notice Option type the vault is selling
    bool public isPut;

    // Token decimals for vault shares
    uint8 internal _decimals;

    /// @notice Current round number. `round` represents the number of `period`s elapsed.
    uint16 public round;

    /// @notice The timestamp of the first round. Used only by consumers to count how many rounds have passed
    uint32 public genesisTimestamp;

    /// @notice Asset used in Theta Vault
    address public asset;

    // Premium discount on options we are selling (thousandths place: 000 - 999)
    uint256 public premiumDiscount;

    // Logic contract used to price options
    address public optionsPremiumPricer;

    // Logic contract used to select strike prices
    /// @notice Underlying asset of the options sold by vault
    address public underlying;

    /// @notice Logic contract used to select strike prices
    address public strikeSelection;

    /// @notice Details on latest round when strike overriden and strike price
    StrikeOverride.StrikeOverrideDetails public strikeOverride;

    /// @notice Current oToken premium
    uint256 public currentOtokenPremium;

    /// @notice Minimum supply of the vault shares issued
    uint256 public minimumSupply;

    // Stores the total tally of how much of collateral there is
    // to be used to mint rTHETA tokens
    uint256 internal _totalPending;

    /// @notice Stores the user's pending deposit for the round
    mapping(address => VaultDeposit.DepositReceipt) public depositReceipts;

    /// @notice On every round's close, the pricePerShare value of an rTHETA token is stored
    /// This is used to determine the number of shares to be returned
    /// to a user with their DepositReceipt.depositAmount
    mapping(uint16 => uint256) public roundPricePerShare;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of OptionsVaultStorage
// e.g. OptionsVaultStorageV<versionNumber>, so finally it would look like
// contract OptionsVaultStorage is OptionsVaultStorageV1, OptionsVaultStorageV2
contract OptionsVaultStorage is
    OptionsVaultStorageV1,
    OptionsVaultStorageV2,
    OptionsVaultStorageV3
{

}
