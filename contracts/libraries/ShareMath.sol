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
        require(pps > PLACEHOLDER_UINT, "Invalid pps");

        uint256 shares =
            uint256(underlyingAmount).mul(10**uint256(decimals)).div(pps);
        assertUint104(shares);

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
        require(pps > PLACEHOLDER_UINT, "Invalid pps");

        uint256 underlyingAmount =
            uint256(shares).mul(pps).div(10**uint256(decimals));
        assertUint104(shares);

        return underlyingAmount;
    }

    /**
     * @notice Returns the shares unredeemed by the user given their DepositReceipt
     * @param depositReceipt is the user's deposit receipt
     * @param currentRound is the `round` stored on the vault
     * @param pps is the price in underlying per share
     * @param decimals is the number of decimals the underlying/shares use
     * @return unredeemedShares is the user's virtual balance of shares that are owed
     */
    function getSharesFromReceipt(
        Vault.DepositReceipt memory depositReceipt,
        uint256 currentRound,
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

            assertUint104(sharesFromRound);

            uint256 unredeemedShares256 =
                uint256(depositReceipt.unredeemedShares).add(sharesFromRound);
            assertUint128(unredeemedShares256);

            unredeemedShares = uint128(unredeemedShares256);
        } else {
            unredeemedShares = depositReceipt.unredeemedShares;
        }
    }

    /************************************************
     *  HELPERS
     ***********************************************/

    function assertUint104(uint256 num) internal pure {
        require(num <= type(uint104).max, ">U104");
    }

    function assertUint128(uint256 num) internal pure {
        require(num <= type(uint128).max, ">U128");
    }
}
