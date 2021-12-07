// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract RibbonTreasuryVaultStorageV1 {
    // Logic contract used to price options
    address public optionsPremiumPricer;
    // Logic contract used to select strike prices
    address public strikeSelection;
    // The asset which denominates the premium during auction
    address public premiumAsset;
    // Whitelist of eligible depositors in array
    address[] public whitelistArray;
    // Whitelist of eligible depositors in mapping
    mapping(address => bool) public whitelistMap;
    // Premium discount on options we are selling (thousandths place: 000 - 999)
    uint256 public premiumDiscount;
    // Current oToken premium
    uint256 public currentOtokenPremium;
    // Auction duration
    uint256 public auctionDuration;
    // Auction id of current option
    uint256 public optionAuctionID;
    // Amount locked for scheduled withdrawals last week;
    uint256 public lastQueuedWithdrawAmount;
    // Period between each options sale.
    uint256 public period;
    // Weekday number for the options sale.
    uint256 public day;
    // Performance fee to be charged if options expire ITM
    uint256 public previousPerformanceFee;
    // Store the performance fee owed from the previous round
    uint256 public performanceFeeOwed;
    // Price last overridden strike set to
    uint256 public overriddenStrikePrice;
    // Last round id at which the strike was manually overridden
    uint16 public lastStrikeOverrideRound;
    // Whether premium proceeds should be distributed.
    bool public distribute;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonTreasuryVaultStorage
// e.g. RibbonTreasuryVaultStorage<versionNumber>, so finally it would look like
// contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1, RibbonTreasuryVaultStorageV2
abstract contract RibbonTreasuryVaultStorage is RibbonTreasuryVaultStorageV1 {

}
