// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

library OptionType {
  struct DigitalOption {
    // Includes 2 decimals (i.e. 10500 = 105%)
    uint256 payoffPCT;
    // Payoff denominated in vault collateral asset, changes every round
    uint256 payoff;
    // Strike of digital option, changes every round
    uint256 strike;
  }
}
