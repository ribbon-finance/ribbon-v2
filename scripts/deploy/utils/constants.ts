/**
 * Addresses
 */
export const ETH_USDC_POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
export const MAINNET_ETH_ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
export const KOVAN_ETH_ORACLE = "0x9326BFA02ADD2366b30bacB125260Af641031331";
export const KOVAN_WETH = "0xd0A1E359811322d97991E03f863a0C30C2cF029C";

export const WBTC_USDC_POOL = "0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35";
export const MAINNET_WBTC_ORACLE = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
export const KOVAN_WBTC_ORACLE = "0x6135b13325bfC4B00278B4abC5e20bbce2D6580e";
export const KOVAN_WBTC = "0x50570256f0da172a1908207aAf0c80d4b279f303";

/**
 * Vault params
 */
export const ETH_STRIKE_STEP = 100; // ETH strike prices move in increments of 1000
export const WBTC_STRIKE_STEP = 1000; // WBTC strike prices move in increments of 1000
export const STRIKE_DELTA = 1000; // 0.1d
export const PREMIUM_DISCOUNT = 800; // 0.80, 20% discount
export const AUCTION_DURATION = 3600; // 1 hour
export const PERFORMANCE_FEE = 0;
export const MANAGEMENT_FEE = 2000000; // 2% per year. 2 * 10**6. Should result in 38356 per week.
