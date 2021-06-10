// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

library VaultDeposit {
    struct DepositReceipt {
        // Flag to mark if processed or not
        bool processed;
        // Maximum of 65535 rounds. Assuming 1 round is 7 days, maximum is 1256 years.
        uint16 round;
        // Deposit amount
        uint128 amount;
    }
}
