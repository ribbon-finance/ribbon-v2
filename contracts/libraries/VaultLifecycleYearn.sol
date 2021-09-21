// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultLifecycle} from "./VaultLifecycle.sol";
import {Vault} from "./Vault.sol";
import {ShareMath} from "./ShareMath.sol";
import {IYearnVault} from "../interfaces/IYearn.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {IStrikeSelection} from "../interfaces/IRibbon.sol";
import {GnosisAuction} from "./GnosisAuction.sol";
import {
    IOtokenFactory,
    IOtoken,
    IController,
    GammaTypes
} from "../interfaces/GammaInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {SupportsNonCompliantERC20} from "./SupportsNonCompliantERC20.sol";

library VaultLifecycleYearn {
    using SafeMath for uint256;
    using SupportsNonCompliantERC20 for IERC20;
    using SafeERC20 for IERC20;

    /**
     * @notice Sets the next option the vault will be shorting, and calculates its premium for the auction
     * @param strikeSelection is the address of the contract with strike selection logic
     * @param optionsPremiumPricer is the address of the contract with the
       black-scholes premium calculation logic
     * @param premiumDiscount is the vault's discount applied to the premium
     * @param closeParams is the struct with details on previous option and strike selection details
     * @param vaultParams is the struct with vault general data
     * @param vaultState is the struct with vault accounting state
     * @param collateralAsset is the address of the collateral asset
     * @return otokenAddress is the address of the new option
     * @return premium is the premium of the new option
     * @return strikePrice is the strike price of the new option
     * @return delta is the delta of the new option
     */
    function commitAndClose(
        address strikeSelection,
        address optionsPremiumPricer,
        uint256 premiumDiscount,
        VaultLifecycle.CloseParams calldata closeParams,
        Vault.VaultParams storage vaultParams,
        Vault.VaultState storage vaultState,
        address collateralAsset
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
        if (closeParams.currentOption == address(0)) {
            expiry = VaultLifecycle.getNextFriday(block.timestamp);
        } else {
            expiry = VaultLifecycle.getNextFriday(
                IOtoken(closeParams.currentOption).expiryTimestamp()
            );
        }

        bool isPut = vaultParams.isPut;

        IStrikeSelection selection = IStrikeSelection(strikeSelection);

        // calculate strike and delta
        (strikePrice, delta) = closeParams.lastStrikeOverrideRound ==
            vaultState.round
            ? (closeParams.overriddenStrikePrice, selection.delta())
            : selection.getStrikePrice(expiry, isPut);

        require(strikePrice != 0, "!strikePrice");

        // retrieve address if option already exists, or deploy it
        otokenAddress = VaultLifecycle.getOrDeployOtoken(
            closeParams,
            vaultParams,
            vaultParams.underlying,
            collateralAsset,
            strikePrice,
            expiry,
            isPut
        );

        // get the black scholes premium of the option and adjust premium based on
        // collateral asset <-> asset exchange rate
        premium = DSMath.wmul(
            GnosisAuction.getOTokenPremium(
                otokenAddress,
                optionsPremiumPricer,
                premiumDiscount
            ),
            IYearnVault(collateralAsset).pricePerShare().mul(
                decimalShift(collateralAsset)
            )
        );

        require(premium > 0, "!premium");

        return (otokenAddress, premium, strikePrice, delta);
    }

    /**
     * @notice Calculate the shares to mint, new price per share, and
      amount of funds to re-allocate as collateral for the new round
     * @param currentShareSupply is the total supply of shares
     * @param currentBalance is the total balance of the vault
     * @param vaultParams is the struct with vault general data
     * @param vaultState is the struct with vault accounting state
     * @return newLockedAmount is the amount of funds to allocate for the new round
     * @return queuedWithdrawAmount is the amount of funds set aside for withdrawal
     * @return newPricePerShare is the price per share of the new round
     * @return mintShares is the amount of shares to mint from deposits
     */
    function rollover(
        uint256 currentShareSupply,
        uint256 currentBalance,
        Vault.VaultParams calldata vaultParams,
        Vault.VaultState calldata vaultState
    )
        external
        pure
        returns (
            uint256 newLockedAmount,
            uint256 queuedWithdrawAmount,
            uint256 newPricePerShare,
            uint256 mintShares
        )
    {
        uint256 pendingAmount = uint256(vaultState.totalPending);
        uint256 _decimals = vaultParams.decimals;

        newPricePerShare = ShareMath.pricePerShare(
            currentShareSupply,
            currentBalance,
            pendingAmount,
            _decimals
        );

        // After closing the short, if the options expire in-the-money
        // vault pricePerShare would go down because vault's asset balance decreased.
        // This ensures that the newly-minted shares do not take on the loss.
        uint256 _mintShares =
            ShareMath.assetToShares(pendingAmount, newPricePerShare, _decimals);

        uint256 newSupply = currentShareSupply.add(_mintShares);

        uint256 queuedAmount =
            newSupply > 0
                ? ShareMath.sharesToAsset(
                    vaultState.queuedWithdrawShares,
                    newPricePerShare,
                    _decimals
                )
                : 0;

        return (
            currentBalance.sub(queuedAmount),
            queuedAmount,
            newPricePerShare,
            _mintShares
        );
    }

    /**
     * @notice Burn the remaining oTokens left over from auction. Currently this implementation is simple.
     * It burns oTokens from the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time.
     * @param gammaController is the address of the opyn controller contract
     * @param currentOption is the address of the current option
     * @return amount of collateral redeemed by burning otokens
     */
    function burnOtokens(address gammaController, address currentOption)
        external
        returns (uint256)
    {
        uint256 numOTokensToBurn =
            IERC20(currentOption).balanceOf(address(this));

        if (numOTokensToBurn < 0) {
            return 0;
        }

        IController controller = IController(gammaController);

        // gets the currently active vault ID
        uint256 vaultID = controller.getAccountVaultCounter(address(this));

        GammaTypes.Vault memory vault =
            controller.getVault(address(this), vaultID);

        require(vault.shortOtokens.length > 0, "No short");

        IERC20 collateralToken = IERC20(vault.collateralAssets[0]);

        uint256 startCollateralBalance =
            collateralToken.balanceOf(address(this));

        // Burning `amount` of oTokens from the ribbon vault,
        // then withdrawing the corresponding collateral amount from the vault
        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](2);

        actions[0] = IController.ActionArgs(
            IController.ActionType.BurnShortOption,
            address(this), // owner
            address(this), // address to transfer from
            address(vault.shortOtokens[0]), // otoken address
            vaultID, // vaultId
            numOTokensToBurn, // amount
            0, //index
            "" //data
        );

        actions[1] = IController.ActionArgs(
            IController.ActionType.WithdrawCollateral,
            address(this), // owner
            address(this), // address to transfer to
            address(collateralToken), // withdrawn asset
            vaultID, // vaultId
            vault.collateralAmounts[0].mul(numOTokensToBurn).div(
                vault.shortAmounts[0]
            ), // amount
            0, //index
            "" //data
        );

        controller.operate(actions);

        uint256 endCollateralBalance = collateralToken.balanceOf(address(this));

        return endCollateralBalance.sub(startCollateralBalance);
    }

    /**
     * @notice Calculates the performance and management fee for this week's round
     * @param vaultState is the struct with vault accounting state
     * @param currentLockedBalance is the amount of funds currently locked in opyn
     * @param performanceFeePercent is the performance fee pct.
     * @param managementFeePercent is the management fee pct.
     * @return performanceFeeInAsset is the performance fee
     * @return managementFeeInAsset is the management fee
     * @return vaultFee is the total fees
     */
    function getVaultFees(
        Vault.VaultState storage vaultState,
        uint256 currentLockedBalance,
        uint256 performanceFeePercent,
        uint256 managementFeePercent
    )
        external
        view
        returns (
            uint256 performanceFeeInAsset,
            uint256 managementFeeInAsset,
            uint256 vaultFee
        )
    {
        uint256 prevLockedAmount = vaultState.lastLockedAmount;

        uint256 lockedBalanceSansPending =
            currentLockedBalance.sub(vaultState.totalPending);

        uint256 _performanceFeeInAsset;
        uint256 _managementFeeInAsset;
        uint256 _vaultFee;

        // Take performance fee and management fee ONLY if difference between
        // last week and this week's vault deposits, taking into account pending
        // deposits and withdrawals, is positive. If it is negative, last week's
        // option expired ITM past breakeven, and the vault took a loss so we
        // do not collect performance fee for last week
        if (lockedBalanceSansPending > prevLockedAmount) {
            _performanceFeeInAsset = performanceFeePercent > 0
                ? lockedBalanceSansPending
                    .sub(prevLockedAmount)
                    .mul(performanceFeePercent)
                    .div(100 * Vault.FEE_MULTIPLIER)
                : 0;
            _managementFeeInAsset = managementFeePercent > 0
                ? currentLockedBalance.mul(managementFeePercent).div(
                    100 * Vault.FEE_MULTIPLIER
                )
                : 0;

            _vaultFee = _performanceFeeInAsset.add(_managementFeeInAsset);
        }

        return (_performanceFeeInAsset, _managementFeeInAsset, _vaultFee);
    }

    /**
     * @notice Withdraws yvWETH + WETH (if necessary) from vault using vault shares
     * @param weth is the weth address
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     * @param recipient is the recipient
     * @param amount is the withdraw amount in `asset`
     * @return withdrawAmount is the withdraw amount in `collateralToken`
     */
    function withdrawYieldAndBaseToken(
        address weth,
        address asset,
        address collateralToken,
        address recipient,
        uint256 amount
    ) external returns (uint256) {
        uint256 pricePerYearnShare =
            IYearnVault(collateralToken).pricePerShare();
        uint256 withdrawAmount =
            DSMath.wdiv(
                amount,
                pricePerYearnShare.mul(decimalShift(collateralToken))
            );
        uint256 yieldTokenBalance =
            withdrawYieldToken(collateralToken, recipient, withdrawAmount);

        // If there is not enough yvWETH in the vault, it withdraws as much as possible and
        // transfers the rest in `asset`
        if (withdrawAmount > yieldTokenBalance) {
            withdrawBaseToken(
                weth,
                asset,
                collateralToken,
                recipient,
                withdrawAmount,
                yieldTokenBalance,
                pricePerYearnShare
            );
        }

        return withdrawAmount;
    }

    /**
     * @notice Withdraws yvWETH from vault
     * @param collateralToken is the address of the collateral token
     * @param recipient is the recipient
     * @param withdrawAmount is the withdraw amount in terms of yearn tokens
     * @return yieldTokenBalance is the balance of the yield token
     */
    function withdrawYieldToken(
        address collateralToken,
        address recipient,
        uint256 withdrawAmount
    ) internal returns (uint256) {
        IERC20 collateral = IERC20(collateralToken);

        uint256 yieldTokenBalance = collateral.balanceOf(address(this));
        uint256 yieldTokensToWithdraw =
            DSMath.min(yieldTokenBalance, withdrawAmount);
        if (yieldTokensToWithdraw > 0) {
            collateral.safeTransfer(recipient, yieldTokensToWithdraw);
        }

        return yieldTokenBalance;
    }

    /**
     * @notice Withdraws `asset` from vault
     * @param weth is the weth address
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     * @param recipient is the recipient
     * @param withdrawAmount is the withdraw amount in terms of yearn tokens
     * @param yieldTokenBalance is the collateral token (yvWETH) balance of the vault
     * @param pricePerYearnShare is the yvWETH<->WETH price ratio
     */
    function withdrawBaseToken(
        address weth,
        address asset,
        address collateralToken,
        address recipient,
        uint256 withdrawAmount,
        uint256 yieldTokenBalance,
        uint256 pricePerYearnShare
    ) internal {
        uint256 underlyingTokensToWithdraw =
            DSMath.mul(
                withdrawAmount.sub(yieldTokenBalance),
                pricePerYearnShare.mul(decimalShift(collateralToken))
            );
        transferAsset(
            weth,
            asset,
            payable(recipient),
            underlyingTokensToWithdraw
        );
    }

    /**
     * @notice Unwraps the necessary amount of the yield-bearing yearn token
     *         and transfers amount to vault
     * @param amount is the amount of `asset` to withdraw
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     * @param yearnWithdrawalBuffer is the buffer for withdrawals from yearn vault
     * @param yearnWithdrawalSlippage is the slippage for withdrawals from yearn vault
     */
    function unwrapYieldToken(
        uint256 amount,
        address asset,
        address collateralToken,
        uint256 yearnWithdrawalBuffer,
        uint256 yearnWithdrawalSlippage
    ) external {
        uint256 assetBalance = IERC20(asset).balanceOf(address(this));
        IYearnVault collateral = IYearnVault(collateralToken);

        uint256 amountToUnwrap =
            DSMath.wdiv(
                DSMath.max(assetBalance, amount).sub(assetBalance),
                collateral.pricePerShare().mul(decimalShift(collateralToken))
            );

        if (amountToUnwrap > 0) {
            amountToUnwrap = amountToUnwrap
                .add(amountToUnwrap.mul(yearnWithdrawalBuffer).div(10000))
                .sub(1);

            collateral.withdraw(
                amountToUnwrap,
                address(this),
                yearnWithdrawalSlippage
            );
        }
    }

    /**
     * @notice Wraps the necessary amount of the base token to the yield-bearing yearn token
     * @param asset is the vault asset address
     * @param collateralToken is the address of the collateral token
     */
    function wrapToYieldToken(address asset, address collateralToken) external {
        uint256 amountToWrap = IERC20(asset).balanceOf(address(this));

        if (amountToWrap > 0) {
            IERC20(asset).safeApprove(collateralToken, amountToWrap);

            // there is a slight imprecision with regards to calculating back from yearn token -> underlying
            // that stems from miscoordination between ytoken .deposit() amount wrapped and pricePerShare
            // at that point in time.
            // ex: if I have 1 eth, deposit 1 eth into yearn vault and calculate value of yearn token balance
            // denominated in eth (via balance(yearn token) * pricePerShare) we will get 1 eth - 1 wei.
            IYearnVault(collateralToken).deposit(amountToWrap, address(this));
        }
    }

    /**
     * @notice Helper function to make either an ETH transfer or ERC20 transfer
     * @param weth is the weth address
     * @param asset is the vault asset address
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(
        address weth,
        address asset,
        address recipient,
        uint256 amount
    ) public {
        if (asset == weth) {
            IWETH(weth).withdraw(amount);
            (bool success, ) = payable(recipient).call{value: amount}("");
            require(success, "!success");
            return;
        }
        IERC20(asset).safeTransfer(recipient, amount);
    }

    /**
     * @notice Returns the decimal shift between 18 decimals and asset tokens
     * @param collateralToken is the address of the collateral token
     */
    function decimalShift(address collateralToken)
        public
        view
        returns (uint256)
    {
        return
            10**(uint256(18).sub(IERC20Detailed(collateralToken).decimals()));
    }
}
