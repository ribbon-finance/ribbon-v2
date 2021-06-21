// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

library Vault {
    struct VaultParams {
        // Option type the vault is selling
        bool isPut;
        // Token decimals for vault shares
        uint8 decimals;
        // Asset used in Theta Vault
        address asset;
        // Logic contract used to select strike prices
        // Underlying asset of the options sold by vault
        address underlying;
        // Minimum supply of the vault shares issued, for ETH it's 10**10
        uint56 minimumSupply;
        // Logic contract used to price options
        address optionsPremiumPricer;
        // Logic contract used to select strike prices
        address strikeSelection;
        // Vault cap
        uint104 cap;
    }

    struct OptionState {
        uint16 lastStrikeOverride;
        // Option that the vault is shorting in the next cycle
        address nextOption;
        // Option that the vault is currently shorting
        address currentOption;
        // The timestamp when the `nextOption` can be used by the vault
        uint32 nextOptionReadyAt;
        uint128 overriddenStrikePrice;
    }

    struct VaultState {
        // 32 byte slot 1
        //  Current round number. `round` represents the number of `period`s elapsed.
        uint16 round;
        // Premium discount on options we are selling (thousandths place: 000 - 999)
        uint32 premiumDiscount;
        // Current oToken premium
        uint104 currentOtokenPremium;
        // Amount that is currently locked for selling options
        uint104 lockedAmount;
        // 32 byte slot 2
        // Stores the total tally of how much of collateral there is
        // to be used to mint rTHETA tokens
        uint128 totalPending;
        // Amount locked for scheduled withdrawals;
        uint128 queuedWithdrawShares;
    }

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

    struct Withdrawal {
        // Flag for marking an initialized withdrawal
        bool initiated;
        // Maximum of 65535 rounds. Assuming 1 round is 7 days, maximum is 1256 years.
        uint16 round;
        // Number of shares withdrawn
        uint128 shares;
    }
}
