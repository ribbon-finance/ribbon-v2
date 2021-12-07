// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {VaultLifecycleTreasury} from "../libraries/VaultLifecycleTreasury.sol";

contract TestVaultLifecycleTreasury {
    function getNextExpiry(
        uint256 currentExpiry,
        uint256 day,
        uint256 interval,
        bool initial
    ) external pure returns (uint256) {
        return
            VaultLifecycleTreasury.getNextExpiry(
                currentExpiry,
                day,
                interval,
                initial
            );
    }
}
