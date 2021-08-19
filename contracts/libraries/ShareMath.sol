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
        uint256 decimals
    ) internal pure returns (uint256) {
        // If this throws, it means that vault's roundPricePerShare[currentRound] has not been set yet
        // which should never happen.
        // Has to be larger than 1 because `1` is used in `initRoundPricePerShares` to prevent cold writes.
        require(pps > PLACEHOLDER_UINT, "Invalid pps");

        return underlyingAmount.mul(10**decimals).div(pps);
    }

    function sharesToUnderlying(
        uint256 shares,
        uint256 pps,
        uint256 decimals
    ) internal pure returns (uint256) {
        // If this throws, it means that vault's roundPricePerShare[currentRound] has not been set yet
        // which should never happen.
        // Has to be larger than 1 because `1` is used in `initRoundPricePerShares` to prevent cold writes.
        require(pps > PLACEHOLDER_UINT, "Invalid pps");

        return shares.mul(pps).div(10**decimals);
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
        uint256 decimals
    ) internal pure returns (uint256 unredeemedShares) {
        if (depositReceipt.round > 0 && depositReceipt.round < currentRound) {
            uint256 sharesFromRound =
                underlyingToShares(depositReceipt.amount, pps, decimals);

            return
                uint256(depositReceipt.unredeemedShares).add(sharesFromRound);
        }
        return depositReceipt.unredeemedShares;
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
