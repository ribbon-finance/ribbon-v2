// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {ShareMath} from "../libraries/ShareMath.sol";

contract TestShareMath {
    function assetToShares(
        uint256 assetAmount,
        uint256 pps,
        uint256 decimals
    ) external pure returns (uint256) {
        return ShareMath.assetToShares(assetAmount, pps, decimals);
    }

    function sharesToAsset(
        uint256 shares,
        uint256 pps,
        uint256 decimals
    ) external pure returns (uint256) {
        return ShareMath.sharesToAsset(shares, pps, decimals);
    }
}
