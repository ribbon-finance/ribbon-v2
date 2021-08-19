// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

import {ShareMath} from "../libraries/ShareMath.sol";

contract TestShareMath {
    function underlyingToShares(
        uint256 underlyingAmount,
        uint256 pps,
        uint256 decimals
    ) external pure returns (uint256) {
        return ShareMath.underlyingToShares(underlyingAmount, pps, decimals);
    }

    function sharesToUnderlying(
        uint256 shares,
        uint256 pps,
        uint256 decimals
    ) external pure returns (uint256) {
        return ShareMath.sharesToUnderlying(shares, pps, decimals);
    }
}
