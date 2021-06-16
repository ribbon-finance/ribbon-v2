// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {IGnosisAuction} from "../interfaces/IGnosisAuction.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {IOptionsPremiumPricer} from "../interfaces/IRibbon.sol";

library GnosisAuction {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event InitiateGnosisAuction(
        address auctioningToken,
        address biddingToken,
        uint256 auctionCounter,
        address manager
    );

    struct AuctionDetails {
        address oTokenAddress;
        address gnosisEasyAuction;
        address asset;
        uint256 oTokenPremium;
        address manager;
        uint256 duration;
    }

    function startAuction(AuctionDetails memory auctionDetails) internal {
        uint256 oTokenSellAmount =
            getOTokenSellAmount(
                auctionDetails.oTokenAddress,
                auctionDetails.gnosisEasyAuction
            );

        if (
            IERC20(auctionDetails.oTokenAddress).allowance(
                address(this),
                auctionDetails.gnosisEasyAuction
            ) > 0
        ) {
            IERC20(auctionDetails.oTokenAddress).safeApprove(
                auctionDetails.gnosisEasyAuction,
                0
            );
        }

        IERC20(auctionDetails.oTokenAddress).safeApprove(
            auctionDetails.gnosisEasyAuction,
            IERC20(auctionDetails.oTokenAddress).balanceOf(address(this))
        );

        uint256 minBidAmount =
            auctionDetails.oTokenPremium.mul(oTokenSellAmount);

        require(
            minBidAmount <= type(uint96).max,
            "optionPremium * oTokenSellAmount > type(uint96) max value!"
        );

        uint256 auctionCounter =
            IGnosisAuction(auctionDetails.gnosisEasyAuction).initiateAuction(
                // address of oToken we minted and are selling
                auctionDetails.oTokenAddress,
                // address of asset we want in exchange for oTokens. Should match vault collateral
                auctionDetails.asset,
                // orders can be cancelled before the auction's halfway point
                block.timestamp.add(auctionDetails.duration.div(2)),
                // order will last for `duration`
                block.timestamp.add(auctionDetails.duration),
                // we are selling all of the otokens minus a fee taken by gnosis
                uint96(oTokenSellAmount),
                // the minimum we are willing to sell all the oTokens for. A discount is applied on black-scholes price
                uint96(minBidAmount),
                // the minimum bidding amount must be 1 * 10 ** -assetDecimals
                1,
                // the min funding threshold
                0,
                // no atomic closure
                false,
                // manager of auction
                auctionDetails.manager,
                // bytes for storing info like a whitelist for who can bid
                bytes("")
            );

        emit InitiateGnosisAuction(
            auctionDetails.oTokenAddress,
            auctionDetails.asset,
            auctionCounter,
            auctionDetails.manager
        );
    }

    function getOTokenSellAmount(
        address oTokenAddress,
        address gnosisEasyAuction
    ) internal returns (uint256 oTokenSellAmount) {
        IGnosisAuction auction = IGnosisAuction(gnosisEasyAuction);
        // We take our current oToken balance and we subtract an
        // amount that is the fee gnosis takes. That will be our sell amount
        // but gnosis will transfer all the otokens
        oTokenSellAmount = IERC20(oTokenAddress)
            .balanceOf(address(this))
            .mul(auction.FEE_DENOMINATOR())
            .div(auction.FEE_DENOMINATOR().add(auction.feeNumerator()));

        require(
            oTokenSellAmount <= type(uint96).max,
            "oTokenSelAmount > type(uint96) max value!"
        );
    }

    function getOTokenPremium(
        address oTokenAddress,
        address gnosisEasyAuction,
        address optionsPremiumPricer,
        uint256 premiumDiscount
    ) internal returns (uint256 optionPremium) {
        IOtoken newOToken = IOtoken(oTokenAddress);
        // Apply black-scholes formula (from rvol library) to option given its features
        // and afterwards apply a discount to incentivize arbitraguers
        optionPremium = IOptionsPremiumPricer(optionsPremiumPricer)
            .getPremium(
            newOToken.strikePrice(),
            newOToken.expiryTimestamp(),
            newOToken.isPut()
        )
            .mul(premiumDiscount)
            .div(1000);

        require(
            optionPremium <= type(uint96).max,
            "optionPremium > type(uint96) max value!"
        );
    }
}
