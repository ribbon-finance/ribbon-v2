// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

library StrikeOverride {
    struct StrikeOverrideDetails {
        uint16 lastStrikeOverride;
        uint128 overriddenStrikePrice;
    }
}
