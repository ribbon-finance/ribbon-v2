// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {RibbonThetaVaultStorageV4} from "./RibbonThetaVaultStorage.sol";

abstract contract AutocallVaultStorageV1 {
    /**
     * VANILLA: normal oToken
     * DIP: down-and-in put. Upon barrier reach digital put is ITM
     * SPREAD: vertical spread
     * LEVERAGED: levered put which magnifies losses depending on how far spot is to 0
     */
    enum OptionType {VANILLA, DIP, SPREAD, LEVERAGED}

    /**
     * FIXED: no coupon barrier. Get all coupons until autocall
     * VANILLA: coupon barrier = autocall barrier.
     *           Get all coupons only upon autocall
     * PHOENIX: coupon barrier < autocall barrier.
     *           Get coupons only on observation periods when spot > coupon barrier
     * PHOENIX_MEMORY: coupon barrier < autocall barrier.
     *           Get all coupons on previous observation periods if current observation period
     *           spot > coupon barrier
     */
    enum CouponType {FIXED, VANILLA, PHOENIX, PHOENIX_MEMORY}

    struct PutOption {
        // Current round option type
        OptionType currentOptionType;
        // Next round option type
        OptionType nextOptionType;
        // Payoff of the option if ITM, denominated in vault collateral asset
        uint256 payoffITM;
    }

    struct CouponState {
        // Current round coupon type
        CouponType currentCouponType;
        // Next round coupon type
        CouponType nextCouponType;
        // Current round autocall barrier PCT.
        // Includes 2 decimals (i.e. 10500 = 105%)
        uint256 autocallBarrierPCT;
        // Next round autocall barrier PCT
        uint256 nextAutocallBarrierPCT;
        // Current round coupon barrier PCT.
        // Includes 2 decimals (i.e. 10500 = 105%)
        uint256 couponBarrierPCT;
        // Next round coupon barrier pct
        uint256 nextCouponBarrierPCT;
    }

    // Vault put option
    PutOption public putOption;
    // Vault coupon state
    CouponState public couponState;
    // 1 day, 7 days, 1 month, etc in seconds
    uint256 public observationPeriodFreq;
    // Next observation period freq
    uint256 internal nextObservationPeriodFreq;
    // Total num observation periods during epoch
    uint256 public numTotalObservationPeriods;
    // Seller of the autocall - they are the counterparty for the short vanilla put + digital put
    address public autocallSeller;
    // Next period
    uint256 public nextPeriod;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonAutocallVaultStorage
// e.g. RibbonAutocallVaultStorage<versionNumber>, so finally it would look like
// contract RibbonAutocallVaultStorage is RibbonAutocallVaultStorageV1, RibbonAutocallVaultStorageV2
abstract contract AutocallVaultStorage is AutocallVaultStorageV1 {

}
