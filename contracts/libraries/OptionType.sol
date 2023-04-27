// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

library OptionType {
    struct DigitalOption {
        // Whether current round has digital put component
        bool hasDigital;
        // Payoff of the digital option if ITM, denominated in vault collateral asset, changes every round
        uint256 payoffITM;
        // Strike of digital option, changes every round
        uint256 strike;
    }
}
