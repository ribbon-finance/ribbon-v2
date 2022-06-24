/**
 * Vault params
 */
export const STRIKE_STEP = {
  "ETH": 100 * 1e8, // ETH strike prices move in increments of 100
  "WBTC": 1000 * 1e8, // WBTC strike prices move in increments of 1000
  "AVAX": 10 * 1e8,
  "AAVE": 10 * 1e8,
  "APE": 1 * 1e8,
  "PERP": 0.1 * 1e8,
};

export const STRIKE_DELTA = 1000; // 0.1d
export const PREMIUM_DISCOUNT = 200; // 0.20, 80% discount
export const AUCTION_DURATION = 600; // 10 minutes
export const PERFORMANCE_FEE = 10000000;
export const MANAGEMENT_FEE = 2000000; // 2% per year. 2 * 10**6. Should result in 38356 per week.

/**
 * Treasury Vault Params
 */
export const PERP_STRIKE_MULTIPLIER = 150;
