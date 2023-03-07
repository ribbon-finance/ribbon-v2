// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {VaultLifecycleTreasury} from "../libraries/VaultLifecycleTreasury.sol";

contract TestVaultLifecycleTreasury {
    function getNextExpiryForPeriod(uint256 currentExpiry, uint256 interval)
        external
        pure
        returns (uint256)
    {
        return
            VaultLifecycleTreasury.getNextExpiryForPeriod(
                currentExpiry,
                interval
            );
    }

    function getNextExpiry(uint256 currentExpiry, uint256 interval)
        external
        view
        returns (uint256)
    {
        return VaultLifecycleTreasury.getNextExpiry(currentExpiry, interval);
    }
}
