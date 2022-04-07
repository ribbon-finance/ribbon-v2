// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract RibbonThetaSTETHVaultStorageV1 {
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

abstract contract RibbonThetaSTETHVaultStorageV2 {
    // Amount locked for scheduled withdrawals last week;
    uint256 public lastQueuedWithdrawAmount;
}

abstract contract RibbonThetaSTETHVaultStorageV3 {
    // LiquidityGauge contract for the vault
    address public liquidityGauge;
}

abstract contract RibbonThetaSTETHVaultStorageV4 {
    // Queued withdraw shares for the current round
    uint256 public currentQueuedWithdrawShares;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonThetaVaultStorage
// e.g. RibbonThetaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonThetaVaultStorage is RibbonThetaVaultStorageV1, RibbonThetaVaultStorageV2
abstract contract RibbonThetaSTETHVaultStorage is
    RibbonThetaSTETHVaultStorageV1,
    RibbonThetaSTETHVaultStorageV2,
    RibbonThetaSTETHVaultStorageV3,
    RibbonThetaSTETHVaultStorageV4
{

}
