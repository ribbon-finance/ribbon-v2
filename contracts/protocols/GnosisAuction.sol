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
    ) internal returns (uint256) {
        (uint256 optionPremium, uint96 oTokenSellAmount) =
            setupAuctionParameters(
                auctionDetails.oTokenAddress,
                gnosisEasyAuction,
                auctionDetails.underlying,
                optionsPremiumPricer,
                auctionDetails.premiumDiscount
            );

        IERC20(auctionDetails.oTokenAddress).safeApprove(gnosisEasyAuction, 0);
        IERC20(auctionDetails.oTokenAddress).safeApprove(
            gnosisEasyAuction,
            IERC20(auctionDetails.oTokenAddress).balanceOf(address(this))
        );

        uint256 auctionCounter =
            IGnosisAuction(gnosisEasyAuction).initiateAuction(
                auctionDetails.oTokenAddress,
                auctionDetails.asset,
                block.timestamp.add(auctionDetails.duration.div(2)),
                block.timestamp.add(auctionDetails.duration),
                oTokenSellAmount,
                0,
                optionPremium,
                0,
                false,
                auctionDetails.manager,
                bytes("")
            );

        return auctionCounter;
    }

    function setupAuctionParameters(
        address oTokenAddress,
        address gnosisEasyAuction,
        address underlying,
        address optionsPremiumPricer,
        uint256 premiumDiscount
    ) internal returns (uint256 optionPremium, uint96 oTokenSellAmount) {
        IOtoken newOToken = IOtoken(oTokenAddress);
        IGnosisAuction auction = IGnosisAuction(gnosisEasyAuction);
        oTokenSellAmount = uint96(
            IERC20(oTokenAddress)
                .balanceOf(address(this))
                .mul(auction.FEE_DENOMINATOR())
                .div(auction.FEE_DENOMINATOR().add(auction.feeNumerator()))
        );

        optionPremium = IOptionsPremiumPricer(optionsPremiumPricer)
            .getPremium(
            underlying,
            newOToken.strikePrice(),
            newOToken.expiryTimestamp(),
            newOToken.isPut()
        )
            .mul(premiumDiscount)
            .div(1000);
    }
}
