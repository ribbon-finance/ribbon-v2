// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";

contract TestVaultLifecycle {
    function getNextFriday(uint256 currentExpiry)
        external
        pure
        returns (uint256 nextFriday)
    {
        return VaultLifecycle.getNextFriday(currentExpiry);
    }

    function balanceOf(address account) public view returns (uint256) {
        if (account == address(this)) {
            return 1 ether;
        }
    }

    function rollover(
        uint256 currentSupply,
        address asset,
        uint8 decimals,
        uint256 pendingAmount,
        uint128 queuedWithdrawShares
    )
        external
        view
        returns (
            uint256 newLockedAmount,
            uint256 newPricePerShare,
            uint256 mintShares
        )
    {
        return
            VaultLifecycle.rollover(
                currentSupply,
                asset,
                decimals,
                pendingAmount,
                queuedWithdrawShares
            );
    }
}
