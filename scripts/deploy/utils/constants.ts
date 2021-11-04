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

export const MAINNET_AAVE = "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9";
export const KOVAN_AAVE = "0x";
export const AAVE_ETH_POOL = "0x5aB53EE1d50eeF2C1DD3d5402789cd27bB52c1bB";
export const MAINNET_AAVE_ORACLE = "0x547a514d5e3769680Ce22B2361c10Ea13619e8a9";
export const KOVAN_AAVE_ORACLE = "0x";

export const YVUSDC = "0x5f18C75AbDAe578b483E5F43f12a39cF75b973a9";

/**
 * Vault params
 */
export const ETH_STRIKE_STEP = 100; // ETH strike prices move in increments of 1000
export const WBTC_STRIKE_STEP = 1000; // WBTC strike prices move in increments of 1000
export const AAVE_STRIKE_STEP = 10;
export const STRIKE_DELTA = 1000; // 0.1d
export const PREMIUM_DISCOUNT = 800; // 0.80, 20% discount
export const AUCTION_DURATION = 3600; // 1 hour
export const PERFORMANCE_FEE = 10000000;
export const MANAGEMENT_FEE = 2000000; // 2% per year. 2 * 10**6. Should result in 38356 per week.
