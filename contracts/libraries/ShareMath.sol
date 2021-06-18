// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

library ShareMath {
    using SafeMath for uint256;

    function underlyingToShares(
        uint256 underlyingAmount,
        uint256 pps,
        uint8 decimals
    ) internal pure returns (uint104) {
        // If this throws, it means that vault's roundPricePerShare[currentRound] has not been set yet
        // which should never happen.
        // Has to be larger than 1 because `1` is used in `initRoundPricePerShares` to prevent cold writes.
        require(pps > 1, "Invalid pps");

        uint256 shares =
            uint256(underlyingAmount).mul(10**uint256(decimals)).div(pps);
        require(shares < type(uint104).max, "Overflow");

        return uint104(shares);
    }

    function sharesToUnderlying(
        uint256 shares,
        uint256 pps,
        uint8 decimals
    ) internal pure returns (uint256) {
        // If this throws, it means that vault's roundPricePerShare[currentRound] has not been set yet
        // which should never happen.
        // Has to be larger than 1 because `1` is used in `initRoundPricePerShares` to prevent cold writes.
        require(pps > 1, "Invalid pps");

        uint256 underlyingAmount =
            uint256(shares).mul(pps).div(10**uint256(decimals));
        require(shares < type(uint104).max, "Overflow");

        return underlyingAmount;
    }
}
