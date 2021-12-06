// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract RibbonTreasuryVaultStorageV1 {
    // Logic contract used to price options
    address public optionsPremiumPricer;
    // Logic contract used to select strike prices
    address public strikeSelection;
    // Premium discount on options we are selling (thousandths place: 000 - 999)
    uint256 public premiumDiscount;
    // Current oToken premium
    uint256 public currentOtokenPremium;
    // Last round id at which the strike was manually overridden
    uint16 public lastStrikeOverrideRound;
    // Price last overridden strike set to
    uint256 public overriddenStrikePrice;
    // Auction duration
    uint256 public auctionDuration;
    // Auction id of current option
    uint256 public optionAuctionID;
    // Amount locked for scheduled withdrawals last week;
    uint256 public lastQueuedWithdrawAmount;
    // Allowed asset for premium denomination
    mapping(address => bool) allowedAssets;
    // The asset which denominates the premium during auction
    address public premiumAsset;
    // Whitelist of eligible depositors in mapping
    mapping(address => bool) public whitelistMap;
    // Whitelist of eligible depositors in array
    address[] public whitelistArray;
    // @notice Period between each options sale.
    uint256 public period;
    // @notice Weekday number to sell options.
    uint256 public day;
    // Whether premium proceeds should be distributed.
    bool public distribute;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonTreasuryVaultStorage
// e.g. RibbonTreasuryVaultStorage<versionNumber>, so finally it would look like
// contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1, RibbonTreasuryVaultStorageV2
abstract contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1 {

}
