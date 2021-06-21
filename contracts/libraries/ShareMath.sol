// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Vault} from "./Vault.sol";

library ShareMath {
    using SafeMath for uint256;

    uint256 constant PLACEHOLDER_UINT = 1;

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

    /**
     * @notice Returns the shares unredeemed by the user given their DepositReceipt
     * @param depositReceipt is the user's deposit receipt
     * @return unredeemedShares is the user's virtual balance of shares that are owed
     */
    function getSharesFromReceipt(
        Vault.DepositReceipt memory depositReceipt,
        uint16 currentRound,
        uint256 pps,
        uint8 decimals
    ) internal pure returns (uint128 unredeemedShares) {
        if (
            depositReceipt.round > 0 &&
            depositReceipt.round < currentRound &&
            !depositReceipt.processed
        ) {
            uint256 sharesFromRound =
                underlyingToShares(depositReceipt.amount, pps, decimals);

            require(sharesFromRound < type(uint104).max, "Overflow");

            uint256 unredeemedShares256 =
                uint256(depositReceipt.unredeemedShares).add(sharesFromRound);
            require(unredeemedShares256 < type(uint128).max, "Overflow");

            unredeemedShares = uint128(unredeemedShares256);
        } else {
            unredeemedShares = depositReceipt.unredeemedShares;
        }
    }

    /************************************************
     *  HELPERS
     ***********************************************/

    function assertUint104(uint256 num) internal pure {
        require(num < type(uint104).max, ">U104");
    }

    function assertUint128(uint256 num) internal pure {
        require(num < type(uint104).max, ">U128");
    }
}
