// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {Vault} from "./Vault.sol";
import {
    IStrikeSelection,
    IOptionsPremiumPricer
} from "../interfaces/IRibbon.sol";
import {GnosisAuction} from "./GnosisAuction.sol";
import {
    IOtokenFactory,
    IOtoken,
    IController,
    GammaTypes
} from "../interfaces/GammaInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";

library VaultLifecycle {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct CloseParams {
        address OTOKEN_FACTORY;
        address USDC;
        address currentOption;
        uint256 delay;
        uint16 lastStrikeOverride;
        uint256 overriddenStrikePrice;
    }

    function commitAndClose(
        address strikeSelection,
        address optionsPremiumPricer,
        uint256 premiumDiscount,
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
            expiry = getNextFriday(block.timestamp);
        } else {
            expiry = getNextFriday(
                IOtoken(closeParams.currentOption).expiryTimestamp()
            );
        }

        IStrikeSelection selection = IStrikeSelection(strikeSelection);

        (strikePrice, delta) = closeParams.lastStrikeOverride ==
            vaultState.round
            ? (closeParams.overriddenStrikePrice, selection.delta())
            : selection.getStrikePrice(expiry, vaultParams.isPut);

        require(strikePrice != 0, "!strikePrice");

        otokenAddress = getOrDeployOtoken(
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
            optionsPremiumPricer,
            premiumDiscount
        );

        require(premium > 0, "!premium");
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
        address asset,
        uint8 decimals,
        uint256 initialSharePrice,
        uint256 pendingAmount,
        uint128 queuedWithdrawShares
    )
        external
        view
        returns (
            uint256 newLockedAmount,
            uint256 newPricePerShare,
            uint256 mintShares
        )
    {
        uint256 currentBalance = IERC20(asset).balanceOf(address(this));
        uint256 roundStartBalance = currentBalance.sub(pendingAmount);

        uint256 singleShare = 10**uint256(decimals);

        newPricePerShare = getPPS(
            currentSupply,
            roundStartBalance,
            singleShare,
            initialSharePrice
        );

        // After closing the short, if the options expire in-the-money
        // vault pricePerShare would go down because vault's asset balance decreased.
        // This ensures that the newly-minted shares do not take on the loss.
        uint256 _mintShares =
            pendingAmount.mul(singleShare).div(newPricePerShare);

        uint256 newSupply = currentSupply.add(_mintShares);

        // TODO: We need to use the pps of the round they scheduled the withdrawal
        // not the pps of the new round. https://github.com/ribbon-finance/ribbon-v2/pull/10#discussion_r652174863
        uint256 queuedWithdrawAmount =
            newSupply > 0
                ? uint256(queuedWithdrawShares).mul(currentBalance).div(
                    newSupply
                )
                : 0;

        uint256 balanceSansQueued = currentBalance.sub(queuedWithdrawAmount);

        return (
            currentBalance.sub(queuedWithdrawAmount),
            newPricePerShare,
            _mintShares
        );
    }

    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/Otoken.sol#L70
    uint256 private constant OTOKEN_DECIMALS = 10**8;

    function createShort(
        address gammaController,
        address marginPool,
        address oTokenAddress,
        uint256 depositAmount
    ) external returns (uint256) {
        IController controller = IController(gammaController);
        uint256 newVaultID =
            (controller.getAccountVaultCounter(address(this))).add(1);

        IOtoken oToken = IOtoken(oTokenAddress);
        uint256 strikePrice = oToken.strikePrice();
        bool isPut = oToken.isPut();
        address collateralAsset = oToken.collateralAsset();
        IERC20 collateralToken = IERC20(collateralAsset);

        uint256 collateralDecimals =
            uint256(IERC20Detailed(collateralAsset).decimals());
        uint256 mintAmount;

        if (isPut) {
            // For minting puts, there will be instances where the full depositAmount will not be used for minting.
            // This is because of an issue with precision.
            //
            // For ETH put options, we are calculating the mintAmount (10**8 decimals) using
            // the depositAmount (10**18 decimals), which will result in truncation of decimals when scaling down.
            // As a result, there will be tiny amounts of dust left behind in the Opyn vault when minting put otokens.
            //
            // For simplicity's sake, we do not refund the dust back to the address(this) on minting otokens.
            // We retain the dust in the vault so the calling contract can withdraw the
            // actual locked amount + dust at settlement.
            //
            // To test this behavior, we can console.log
            // MarginCalculatorInterface(0x7A48d10f372b3D7c60f6c9770B91398e4ccfd3C7).getExcessCollateral(vault)
            // to see how much dust (or excess collateral) is left behind.
            mintAmount = dswdiv(
                depositAmount.mul(OTOKEN_DECIMALS),
                strikePrice.mul(10**10) // we need to scale strikePrice to wad
            )
                .div(10**collateralDecimals);
        } else {
            mintAmount = depositAmount;
            uint256 scaleBy = 10**(collateralDecimals.sub(8)); // oTokens have 8 decimals

            if (mintAmount > scaleBy && collateralDecimals > 8) {
                mintAmount = depositAmount.div(scaleBy); // scale down from 10**18 to 10**8
                require(mintAmount > 0, "depositAmount < 10**8");
            }
        }

        // double approve to fix non-compliant ERC20s
        collateralToken.safeApprove(marginPool, 0);
        collateralToken.safeApprove(marginPool, depositAmount);

        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](3);

        actions[0] = IController.ActionArgs(
            IController.ActionType.OpenVault,
            address(this), // owner
            address(this), // receiver -  we need this contract to receive so we can swap at the end
            address(0), // asset, otoken
            newVaultID, // vaultId
            0, // amount
            0, //index
            "" //data
        );

        actions[1] = IController.ActionArgs(
            IController.ActionType.DepositCollateral,
            address(this), // owner
            address(this), // address to transfer from
            collateralAsset, // deposited asset
            newVaultID, // vaultId
            depositAmount, // amount
            0, //index
            "" //data
        );

        actions[2] = IController.ActionArgs(
            IController.ActionType.MintShortOption,
            address(this), // owner
            address(this), // address to transfer to
            oTokenAddress, // deposited asset
            newVaultID, // vaultId
            mintAmount, // amount
            0, //index
            "" //data
        );

        controller.operate(actions);

        return mintAmount;
    }

    /**
     * @notice Close the existing short otoken position. Currently this implementation is simple.
     * It closes the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time. Since calling `closeShort` deletes vaults,
     * this assumption should hold.
     */
    function settleShort(address gammaController) external returns (uint256) {
        IController controller = IController(gammaController);

        // gets the currently active vault ID
        uint256 vaultID = controller.getAccountVaultCounter(address(this));

        GammaTypes.Vault memory vault =
            controller.getVault(address(this), vaultID);

        require(vault.shortOtokens.length > 0, "No short");

        IERC20 collateralToken = IERC20(vault.collateralAssets[0]);

        uint256 startCollateralBalance =
            collateralToken.balanceOf(address(this));

        // If it is after expiry, we need to settle the short position using the normal way
        // Delete the vault and withdraw all remaining collateral from the vault
        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](1);

        actions[0] = IController.ActionArgs(
            IController.ActionType.SettleVault,
            address(this), // owner
            address(this), // address to transfer to
            address(0), // not used
            vaultID, // vaultId
            0, // not used
            0, // not used
            "" // not used
        );

        controller.operate(actions);

        uint256 endCollateralBalance = collateralToken.balanceOf(address(this));

        return endCollateralBalance.sub(startCollateralBalance);
    }

    /**
     * @notice Exercises the ITM option using existing long otoken position. Currently this implementation is simple.
     * It calls the `Redeem` action to claim the payout.
     */
    function settleLong(
        address gammaController,
        address oldOption,
        address asset
    ) external returns (uint256) {
        IController controller = IController(gammaController);

        uint256 oldOptionBalance = IERC20(oldOption).balanceOf(address(this));

        if (controller.getPayout(oldOption, oldOptionBalance) == 0) {
            return 0;
        }

        uint256 startAssetBalance = IERC20(asset).balanceOf(address(this));

        // If it is after expiry, we need to redeem the profits
        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](1);

        actions[0] = IController.ActionArgs(
            IController.ActionType.Redeem,
            address(0), // not used
            address(this), // address to send profits to
            oldOption, // address of otoken
            0, // not used
            oldOptionBalance, // otoken balance
            0, // not used
            "" // not used
        );

        controller.operate(actions);

        uint256 endAssetBalance = IERC20(asset).balanceOf(address(this));

        return endAssetBalance.sub(startAssetBalance);
    }

    /**
     * @notice Burn the remaining oTokens left over from auction. Currently this implementation is simple.
     * It burns oTokens from the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time.
     */
    function burnOtokens(address gammaController, uint256 amount)
        external
        returns (uint256)
    {
        IController controller = IController(gammaController);

        // gets the currently active vault ID
        uint256 vaultID = controller.getAccountVaultCounter(address(this));

        GammaTypes.Vault memory vault =
            controller.getVault(address(this), vaultID);

        require(vault.shortOtokens.length > 0, "No short");

        IERC20 collateralToken = IERC20(vault.collateralAssets[0]);

        uint256 startCollateralBalance =
            collateralToken.balanceOf(address(this));

        // Burning all otokens that are left from the gnosis auction,
        // then withdrawing the corresponding collateral amount from the vault
        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](2);

        actions[0] = IController.ActionArgs(
            IController.ActionType.BurnShortOption,
            address(this), // owner
            address(this), // address to transfer to
            address(vault.shortOtokens[0]), // otoken address
            vaultID, // vaultId
            amount, // amount
            0, //index
            "" //data
        );

        actions[1] = IController.ActionArgs(
            IController.ActionType.WithdrawCollateral,
            address(this), // owner
            address(this), // address to transfer to
            address(collateralToken), // withdrawn asset
            vaultID, // vaultId
            vault.collateralAmounts[0].mul(amount).div(vault.shortAmounts[0]), // amount
            0, //index
            "" //data
        );

        controller.operate(actions);

        uint256 endCollateralBalance = collateralToken.balanceOf(address(this));

        return endCollateralBalance.sub(startCollateralBalance);
    }

    function getOrDeployOtoken(
        address otokenFactory,
        address underlying,
        address strikeAsset,
        address collateralAsset,
        uint256 strikePrice,
        uint256 expiry,
        bool isPut
    ) internal returns (address) {
        IOtokenFactory factory = IOtokenFactory(otokenFactory);

        address otokenFromFactory =
            factory.getOtoken(
                underlying,
                strikeAsset,
                collateralAsset,
                strikePrice,
                expiry,
                isPut
            );

        if (otokenFromFactory != address(0)) {
            return otokenFromFactory;
        }

        address otoken =
            factory.createOtoken(
                underlying,
                strikeAsset,
                collateralAsset,
                strikePrice,
                expiry,
                isPut
            );
        return otoken;
    }

    function startAuction(GnosisAuction.AuctionDetails calldata auctionDetails)
        external
        returns (uint256)
    {
        return GnosisAuction.startAuction(auctionDetails);
    }

    function placeBid(GnosisAuction.BidDetails calldata bidDetails)
        external
        returns (
            uint256,
            uint256,
            uint64
        )
    {
        return GnosisAuction.placeBid(bidDetails);
    }

    function claimAuctionOtokens(
        Vault.AuctionSellOrder calldata auctionSellOrder,
        address gnosisEasyAuction,
        address counterpartyThetaVault
    ) external {
        GnosisAuction.claimAuctionOtokens(
            auctionSellOrder,
            gnosisEasyAuction,
            counterpartyThetaVault
        );
    }

    function verifyConstructorParams(
        address owner,
        address feeRecipient,
        uint256 performanceFee,
        string calldata tokenName,
        string calldata tokenSymbol,
        Vault.VaultParams calldata _vaultParams
    ) external pure {
        require(owner != address(0), "!owner");
        require(feeRecipient != address(0), "!feeRecipient");
        require(performanceFee > 0, "!performanceFee");
        require(bytes(tokenName).length > 0, "!tokenName");
        require(bytes(tokenSymbol).length > 0, "!tokenSymbol");

        require(_vaultParams.asset != address(0), "!asset");

        require(_vaultParams.decimals > 0, "!tokenDecimals");
        require(_vaultParams.minimumSupply > 0, "!minimumSupply");
        require(_vaultParams.cap > 0, "!cap");
        require(_vaultParams.initialSharePrice > 0, "!initialSharePrice");
    }

    /**
     * @notice Gets the next options expiry timestamp
     */
    function getNextFriday(uint256 currentExpiry)
        internal
        pure
        returns (uint256)
    {
        uint256 nextWeek = currentExpiry + 86400 * 7;
        uint256 dayOfWeek = ((nextWeek / 86400) + 4) % 7;

        uint256 friday;
        if (dayOfWeek > 5) {
            friday = nextWeek - 86400 * (dayOfWeek - 5);
        } else {
            friday = nextWeek + 86400 * (5 - dayOfWeek);
        }

        uint256 friday8am =
            (friday - (friday % (60 * 60 * 24))) + (8 * 60 * 60);
        return friday8am;
    }

    function getPPS(
        uint256 currentSupply,
        uint256 roundStartBalance,
        uint256 singleShare,
        uint256 initialSharePrice
    ) internal pure returns (uint256 newPricePerShare) {
        newPricePerShare = currentSupply > 0
            ? singleShare.mul(roundStartBalance).div(currentSupply)
            : initialSharePrice;
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
    function dswdiv(uint256 x, uint256 y) private pure returns (uint256 z) {
        z = dsadd(dsmul(x, DSWAD), y / 2) / y;
    }
}
