// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

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
