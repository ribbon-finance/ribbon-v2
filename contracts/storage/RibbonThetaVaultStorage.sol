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
    // DEPRECATED: Auction will be denominated in USDC if true
    bool private _isUsdcAuction;
    // DEPRECATED: Path for swaps
    bytes private _swapPath;
}

abstract contract RibbonThetaVaultStorageV4 {
    // LiquidityGauge contract for the vault
    address public liquidityGauge;
}

abstract contract RibbonThetaVaultStorageV5 {
    // Leverage Factor
    // between 1x - 2x). lev factor of 100% = 10 ** 6. lev factor of 200% = 2 * 10 ** 6
    uint256 public levFactor;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonThetaVaultStorage
// e.g. RibbonThetaVaultStorage<versionNumber>, so finally it would look like
// contract RibbonThetaVaultStorage is RibbonThetaVaultStorageV1, RibbonThetaVaultStorageV2
abstract contract RibbonThetaVaultStorage is
    RibbonThetaVaultStorageV1,
    RibbonThetaVaultStorageV2,
    RibbonThetaVaultStorageV3,
    RibbonThetaVaultStorageV4,
    RibbonThetaVaultStorageV5
{

}
