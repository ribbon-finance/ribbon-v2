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
        address asset;
        address underlying;
        address manager;
        uint256 premiumDiscount;
        uint256 duration;
    }

    function startAuction(
        address gnosisEasyAuction,
        address optionsPremiumPricer,
        AuctionDetails memory auctionDetails
    ) internal {
        (uint256 optionPremium, uint256 oTokenSellAmount) =
            setupAuctionParameters(
                auctionDetails.oTokenAddress,
                gnosisEasyAuction,
                auctionDetails.underlying,
                optionsPremiumPricer,
                auctionDetails.premiumDiscount
            );

        if (
            IERC20(auctionDetails.oTokenAddress).allowance(
                address(this),
                gnosisEasyAuction
            ) > 0
        ) {
            IERC20(auctionDetails.oTokenAddress).safeApprove(
                gnosisEasyAuction,
                0
            );
        }

        IERC20(auctionDetails.oTokenAddress).safeApprove(
            gnosisEasyAuction,
            IERC20(auctionDetails.oTokenAddress).balanceOf(address(this))
        );

        uint256 auctionCounter =
            IGnosisAuction(gnosisEasyAuction).initiateAuction(
                auctionDetails.oTokenAddress, // address of oToken we minted and are selling
                auctionDetails.asset, // address of asset we want in exchange for oTokens. Should match vault collateral
                block.timestamp.add(auctionDetails.duration.div(2)), // orders can be cancelled before the auction's halfway point
                block.timestamp.add(auctionDetails.duration), // order will last for `duration`
                uint96(oTokenSellAmount), // we are selling all of the otokens minus a fee taken by gnosis
                uint96(optionPremium.mul(oTokenSellAmount)), // the minimum we are willing to sell all the oTokens for. A discount is applied on black-scholes price
                1, // the minimum bidding amount must be 1 * 10 ** -assetDecimals
                0, // the min funding threshold
                false, // no atomic closure
                auctionDetails.manager, // manager of auction
                bytes("") // bytes for storing info like a whitelist for who can bid
            );

        emit InitiateGnosisAuction(
            auctionDetails.oTokenAddress,
            auctionDetails.asset,
            auctionCounter,
            auctionDetails.manager
        );
    }

    function setupAuctionParameters(
        address oTokenAddress,
        address gnosisEasyAuction,
        address underlying,
        address optionsPremiumPricer,
        uint256 premiumDiscount
    ) internal returns (uint256 optionPremium, uint256 oTokenSellAmount) {
        IOtoken newOToken = IOtoken(oTokenAddress);
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
            "oTokenSellAmount > type(uint96) max value!"
        );

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

        require(
            optionPremium.mul(oTokenSellAmount) <= type(uint96).max,
            "optionPremium * oTokenSellAmount > type(uint96) max value!"
        );
    }
}
