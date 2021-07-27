// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {IGnosisAuction} from "../interfaces/IGnosisAuction.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {IOptionsPremiumPricer} from "../interfaces/IRibbon.sol";
import {Vault} from "./Vault.sol";
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";

library GnosisAuction {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    event InitiateGnosisAuction(
        address auctioningToken,
        address biddingToken,
        uint256 auctionCounter,
        address manager
    );

    event PlaceAuctionBid(
        uint256 auctionId,
        address auctioningToken,
        uint256 sellAmount,
        uint256 buyAmount,
        address bidder
    );

    struct AuctionDetails {
        address oTokenAddress;
        address gnosisEasyAuction;
        address asset;
        uint256 assetDecimals;
        uint256 oTokenPremium;
        uint256 duration;
    }

    struct BidDetails {
        address oTokenAddress;
        address gnosisEasyAuction;
        address asset;
        uint256 assetDecimals;
        uint256 auctionId;
        uint256 lockedBalance;
        uint256 optionAllocationPct;
        uint256 optionPremium;
        address bidder;
    }

    function startAuction(AuctionDetails calldata auctionDetails)
        internal
        returns (uint256 auctionID)
    {
        uint256 oTokenSellAmount =
            getOTokenSellAmount(auctionDetails.oTokenAddress);

        IERC20(auctionDetails.oTokenAddress).safeApprove(
            auctionDetails.gnosisEasyAuction,
            IERC20(auctionDetails.oTokenAddress).balanceOf(address(this))
        );

        // minBidAmount is total oTokens to sell * premium per oToken
        // shift decimals to correspond to decimals of USDC for puts
        // and underlying for calls
        uint256 minBidAmount =
            dswmul(oTokenSellAmount.mul(10**10), auctionDetails.oTokenPremium)
                .div(10**(uint256(18).sub(auctionDetails.assetDecimals)));

        require(
            minBidAmount <= type(uint96).max,
            "optionPremium * oTokenSellAmount > type(uint96) max value!"
        );

        auctionID = IGnosisAuction(auctionDetails.gnosisEasyAuction)
            .initiateAuction(
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
            // access manager contract
            address(0),
            // bytes for storing info like a whitelist for who can bid
            bytes("")
        );

        emit InitiateGnosisAuction(
            auctionDetails.oTokenAddress,
            auctionDetails.asset,
            auctionID,
            msg.sender
        );
    }

    function placeBid(BidDetails calldata bidDetails)
        internal
        returns (
            uint256 sellAmount,
            uint256 buyAmount,
            uint64 userId
        )
    {
        // calculate how much to allocate
        sellAmount = bidDetails
            .lockedBalance
            .mul(bidDetails.optionAllocationPct)
            .div(10000);

        // divide the `asset` sellAmount by the target premium per oToken to
        // get the number of oTokens to buy (8 decimals)
        buyAmount = sellAmount
            .mul(10**bidDetails.assetDecimals)
            .div(bidDetails.optionPremium)
            .mul(10**8)
            .div(10**bidDetails.assetDecimals);

        require(
            sellAmount <= type(uint96).max,
            "sellAmount > type(uint96) max value!"
        );
        require(
            buyAmount <= type(uint96).max,
            "buyAmount > type(uint96) max value!"
        );

        // approve that amount
        IERC20(bidDetails.asset).safeApprove(
            bidDetails.gnosisEasyAuction,
            sellAmount
        );

        uint96[] memory _minBuyAmounts = new uint96[](1);
        uint96[] memory _sellAmounts = new uint96[](1);
        bytes32[] memory _prevSellOrders = new bytes32[](1);
        _minBuyAmounts[0] = uint96(buyAmount);
        _sellAmounts[0] = uint96(sellAmount);
        _prevSellOrders[
            0
        ] = 0x0000000000000000000000000000000000000000000000000000000000000001;

        // place sell order with that amount
        userId = IGnosisAuction(bidDetails.gnosisEasyAuction).placeSellOrders(
            bidDetails.auctionId,
            _minBuyAmounts,
            _sellAmounts,
            _prevSellOrders,
            "0x"
        );

        emit PlaceAuctionBid(
            bidDetails.auctionId,
            bidDetails.oTokenAddress,
            sellAmount,
            buyAmount,
            bidDetails.bidder
        );
    }

    function claimAuctionOtokens(
        Vault.AuctionSellOrder calldata auctionSellOrder,
        address gnosisEasyAuction,
        address counterpartyThetaVault
    ) internal {
        bytes32 order =
            encodeOrder(
                auctionSellOrder.userId,
                auctionSellOrder.buyAmount,
                auctionSellOrder.sellAmount
            );
        bytes32[] memory orders = new bytes32[](1);
        orders[0] = order;
        IGnosisAuction(gnosisEasyAuction).claimFromParticipantOrder(
            IRibbonThetaVault(counterpartyThetaVault).optionAuctionID(),
            orders
        );
    }

    function getOTokenSellAmount(address oTokenAddress)
        internal
        view
        returns (uint256 oTokenSellAmount)
    {
        // We take our current oToken balance. That will be our sell amount
        // but gnosis will transfer all the otokens
        oTokenSellAmount = IERC20(oTokenAddress).balanceOf(address(this));

        require(
            oTokenSellAmount <= type(uint96).max,
            "oTokenSellAmount > type(uint96) max value!"
        );
    }

    function getOTokenPremium(
        address oTokenAddress,
        address optionsPremiumPricer,
        uint256 premiumDiscount
    ) internal view returns (uint256 optionPremium) {
        IOtoken newOToken = IOtoken(oTokenAddress);
        IOptionsPremiumPricer premiumPricer =
            IOptionsPremiumPricer(optionsPremiumPricer);

        // Apply black-scholes formula (from rvol library) to option given its features
        // and get price for 100 contracts denominated in the underlying asset for call option
        // and USDC for put option
        optionPremium = premiumPricer.getPremium(
            newOToken.strikePrice(),
            newOToken.expiryTimestamp(),
            newOToken.isPut()
        );

        // Apply a discount to incentivize arbitraguers
        optionPremium = optionPremium.mul(premiumDiscount).div(1000);

        require(
            optionPremium <= type(uint96).max,
            "optionPremium > type(uint96) max value!"
        );
    }

    function encodeOrder(
        uint64 userId,
        uint96 buyAmount,
        uint96 sellAmount
    ) internal pure returns (bytes32) {
        return
            bytes32(
                (uint256(userId) << 192) +
                    (uint256(buyAmount) << 96) +
                    uint256(sellAmount)
            );
    }

    /***
     * DSMath Copy paste
     */

    uint256 constant DSWAD = 10**18;

    function dsadd(uint256 x, uint256 y) private pure returns (uint256 z) {
        require((z = x + y) >= x, "ds-math-add-overflow");
    }

    function dsmul(uint256 x, uint256 y) private pure returns (uint256 z) {
        require(y == 0 || (z = x * y) / y == x, "ds-math-mul-overflow");
    }

    //rounds to zero if x*y < WAD / 2
    function dswmul(uint256 x, uint256 y) internal pure returns (uint256 z) {
        z = dsadd(dsmul(x, y), DSWAD / 2) / DSWAD;
    }
}
