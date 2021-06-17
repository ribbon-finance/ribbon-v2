// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

library VaultDeposit {
    struct DepositReceipt {
        // Flag to mark if processed or not
        bool processed;
        // Maximum of 65535 rounds. Assuming 1 round is 7 days, maximum is 1256 years.
        uint16 round;
        // Deposit amount, max 20,282,409,603,651 or 20 trillion ETH deposit
        uint104 amount;
        // Unredeemed shares balance
        uint128 unredeemedShares;
    }
}
