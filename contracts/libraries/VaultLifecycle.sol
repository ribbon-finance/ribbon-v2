// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Vault} from "./Vault.sol";
import {
    IStrikeSelection,
    IOptionsPremiumPricer
} from "../interfaces/IRibbon.sol";
import {GammaProtocol} from "../protocols/GammaProtocol.sol";
import {GnosisAuction} from "../protocols/GnosisAuction.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";

library VaultLifecycle {
    using SafeMath for uint256;

    uint128 private constant PLACEHOLDER_UINT = 1;
    address private constant PLACEHOLDER_ADDR = address(1);

    struct CloseParams {
        address OTOKEN_FACTORY;
        address USDC;
        address currentOption;
        uint256 delay;
        uint256 overridenStrikePrice;
    }

    function commitAndClose(
        CloseParams calldata closeParams,
        Vault.VaultParams calldata vaultParams,
        Vault.VaultState calldata vaultState
    )
        external
        returns (
            address otokenAddress,
            uint256 premium,
            uint256 strikePrice,
            uint256 delta
        )
    {
        uint256 expiry;

        // uninitialized state
        if (closeParams.currentOption <= address(1)) {
            expiry = GammaProtocol.getNextFriday(block.timestamp);
        } else {
            expiry = GammaProtocol.getNextFriday(
                IOtoken(closeParams.currentOption).expiryTimestamp()
            );
        }

        IStrikeSelection selection =
            IStrikeSelection(vaultParams.strikeSelection);

        (strikePrice, delta) = vaultState.lastStrikeOverride == vaultState.round
            ? (closeParams.overridenStrikePrice, selection.delta())
            : selection.getStrikePrice(expiry, vaultParams.isPut);

        require(strikePrice != 0, "!strikePrice");

        otokenAddress = GammaProtocol.getOrDeployOtoken(
            closeParams.OTOKEN_FACTORY,
            vaultParams.underlying,
            closeParams.USDC,
            vaultParams.asset,
            strikePrice,
            expiry,
            vaultParams.isPut
        );

        verifyOtoken(
            otokenAddress,
            vaultParams,
            closeParams.USDC,
            closeParams.delay
        );

        premium = GnosisAuction.getOTokenPremium(
            otokenAddress,
            vaultParams.optionsPremiumPricer,
            vaultState.premiumDiscount
        );

        require(premium > 0, "!premium");
    }

    function createShort(
        address gammaController,
        address marginPool,
        address oTokenAddress,
        uint256 depositAmount
    ) external returns (uint256) {
        GammaProtocol.createShort(
            gammaController,
            marginPool,
            oTokenAddress,
            depositAmount
        );
    }

    function settleShort(address GAMMA_CONTROLLER) public returns (uint256) {
        return GammaProtocol.settleShort(GAMMA_CONTROLLER);
    }

    function verifyOtoken(
        address otokenAddress,
        Vault.VaultParams calldata vaultParams,
        address USDC,
        uint256 delay
    ) private view {
        require(otokenAddress != address(0), "!otokenAddress");

        IOtoken otoken = IOtoken(otokenAddress);
        require(otoken.isPut() == vaultParams.isPut, "Type mismatch");
        require(
            otoken.underlyingAsset() == vaultParams.underlying,
            "Wrong underlyingAsset"
        );
        require(
            otoken.collateralAsset() == vaultParams.asset,
            "Wrong collateralAsset"
        );

        // we just assume all options use USDC as the strike
        require(otoken.strikeAsset() == USDC, "strikeAsset != USDC");

        uint256 readyAt = block.timestamp.add(delay);
        require(otoken.expiryTimestamp() >= readyAt, "Expiry before delay");
    }

    function rollover(
        uint256 currentSupply,
        Vault.VaultParams calldata vaultParams,
        Vault.VaultState calldata vaultState
    )
        external
        view
        returns (uint256 newLockedAmount, uint256 newPricePerShare)
    {
        uint256 pendingAmount =
            uint256(vaultState.totalPending).sub(PLACEHOLDER_UINT);
        uint256 currentBalance =
            IERC20(vaultParams.asset).balanceOf(address(this));
        uint256 roundStartBalance = currentBalance.sub(pendingAmount);

        uint256 singleShare = 10**uint256(vaultParams.decimals);

        newPricePerShare = currentSupply > 0
            ? singleShare.mul(roundStartBalance).div(currentSupply)
            : singleShare;

        // After closing the short, if the options expire in-the-money
        // vault pricePerShare would go down because vault's asset balance decreased.
        // This ensures that the newly-minted shares do not take on the loss.
        uint256 mintShares =
            pendingAmount.mul(singleShare).div(newPricePerShare);

        uint256 newSupply = currentSupply.add(mintShares);

        // TODO: We need to use the pps of the round they scheduled the withdrawal
        // not the pps of the new round. https://github.com/ribbon-finance/ribbon-v2/pull/10#discussion_r652174863
        uint256 queuedWithdrawAmount =
            newSupply > 0
                ? uint256(vaultState.queuedWithdrawShares)
                    .mul(currentBalance)
                    .div(newSupply)
                : 0;

        uint256 balanceSansQueued = currentBalance.sub(queuedWithdrawAmount);

        return (balanceSansQueued, newPricePerShare);
    }

    function burnRemainingOTokens(
        address GAMMA_CONTROLLER,
        address currentOption,
        Vault.VaultParams calldata vaultParams,
        Vault.VaultState calldata vaultState
    ) external returns (uint256) {
        uint256 numOTokensToBurn =
            IERC20(currentOption).balanceOf(address(this));
        require(numOTokensToBurn > 0, "!otokens");

        uint256 assetBalanceBeforeBurn =
            IERC20(vaultParams.asset).balanceOf(address(this));

        GammaProtocol.burnOtokens(GAMMA_CONTROLLER, numOTokensToBurn);

        uint256 assetBalanceAfterBurn =
            IERC20(vaultParams.asset).balanceOf(address(this));

        return
            uint256(vaultState.lockedAmount).sub(
                assetBalanceAfterBurn.sub(assetBalanceBeforeBurn)
            );
    }

    /**
     * @notice Initiate the gnosis auction.
     */
    function startAuction(
        address GNOSIS_EASY_AUCTION,
        address owner,
        address currentOption,
        Vault.VaultParams calldata vaultParams,
        Vault.VaultState calldata vaultState
    ) external {
        GnosisAuction.AuctionDetails memory auctionDetails;

        uint256 currentOtokenPremium = vaultState.currentOtokenPremium;

        require(currentOtokenPremium > 0, "!currentOtokenPremium");

        auctionDetails.oTokenAddress = currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = vaultParams.asset;
        auctionDetails.oTokenPremium = currentOtokenPremium;
        auctionDetails.manager = owner;
        auctionDetails.duration = 6 hours;

        GnosisAuction.startAuction(auctionDetails);
    }
}
