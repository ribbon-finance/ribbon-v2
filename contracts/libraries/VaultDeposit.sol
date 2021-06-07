// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

library VaultDeposit {
    struct DepositReceipt {
        bool processed;
        uint16 round;
        uint128 amount;
    }
}
