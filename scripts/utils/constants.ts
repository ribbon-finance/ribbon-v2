/**
 * Addresses
 */
export const MAINNET_AAVE = "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9";
export const KOVAN_AAVE = "0x0000000000000000000000000000000000000000";  // Must update for Kovan
export const AAVE_ETH_POOL = "0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB";
export const MAINNET_AAVE_ORACLE = "0x547a514d5e3769680Ce22B2361c10Ea13619e8a9";
export const KOVAN_AAVE_ORACLE = "0x0000000000000000000000000000000000000000";  // Must update for Kovan

/**
 * Vault params
 */
export const ETH_STRIKE_STEP = 100; // ETH strike prices move in increments of 1000
export const WBTC_STRIKE_STEP = 1000; // WBTC strike prices move in increments of 1000
export const AAVE_STRIKE_STEP = 10;
export const STRIKE_DELTA = 1000; // 0.1d
export const PREMIUM_DISCOUNT = 200; // 0.20, 80% discount
export const AUCTION_DURATION = 3600; // 1 hour
export const PERFORMANCE_FEE = 10000000;
export const MANAGEMENT_FEE = 2000000; // 2% per year. 2 * 10**6. Should result in 38356 per week.
