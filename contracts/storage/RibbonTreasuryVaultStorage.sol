// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract RibbonThetaVaultStorageV1 {
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
}

abstract contract RibbonThetaVaultStorageV2 {
    // Amount locked for scheduled withdrawals last week;
    uint256 public lastQueuedWithdrawAmount;
}

abstract contract RibbonThetaVaultStorageV3 {
    // Auction will be denominated in USDC if true
    bool public isUsdcAuction;
    // Path for swaps
    bytes public swapPath;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonThetaVaultStorage
// e.g. RibbonThetaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonThetaVaultStorage is RibbonThetaVaultStorageV1, RibbonThetaVaultStorageV2
abstract contract RibbonThetaVaultStorage is
    RibbonThetaVaultStorageV1,
    RibbonThetaVaultStorageV2,
    RibbonThetaVaultStorageV3
{

}
