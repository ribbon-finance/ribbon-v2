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
}
