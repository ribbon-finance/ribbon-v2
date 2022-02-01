/**
 * Vault params
 */
export const AVAX_STRIKE_STEP = 10;
export const ETH_STRIKE_STEP = 100; // ETH strike prices move in increments of 100
export const WBTC_STRIKE_STEP = 1000; // WBTC strike prices move in increments of 1000
export const AAVE_STRIKE_STEP = 10;
export const NEAR_STRIKE_STEP = 5;
export const AURORA_STRIKE_STEP = 5;

export const STRIKE_DELTA = 1000; // 0.1d
export const PREMIUM_DISCOUNT = 200; // 0.20, 80% discount
export const AUCTION_DURATION = 3600; // 1 hour
export const PERFORMANCE_FEE = 10000000;
export const MANAGEMENT_FEE = 2000000; // 2% per year. 2 * 10**6. Should result in 38356 per week.

/**
 * Treasury Vault Params
 */
export const PERP_STRIKE_STEP = 10000000;
export const PERP_STRIKE_MULTIPLIER = 150;
