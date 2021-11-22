// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultLifecycle} from "./VaultLifecycle.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vault} from "./Vault.sol";
import {ShareMath} from "./ShareMath.sol";
import {ISTETH, IWSTETH} from "../interfaces/ISTETH.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {ICRV} from "../interfaces/ICRV.sol";
import {IStrikeSelection} from "../interfaces/IRibbon.sol";
import {GnosisAuction} from "./GnosisAuction.sol";
import {
    IOtokenFactory,
    IOtoken,
    IController,
    GammaTypes
} from "../interfaces/GammaInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";

library VaultLifecycleSTETH {
    using SafeMath for uint256;
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

        IStrikeSelection selection = IStrikeSelection(strikeSelection);

        // calculate strike and delta
        (strikePrice, delta) = closeParams.lastStrikeOverrideRound ==
            vaultState.round
            ? (closeParams.overriddenStrikePrice, selection.delta())
            : selection.getStrikePrice(expiry, false);

        require(strikePrice != 0, "!strikePrice");

        // retrieve address if option already exists, or deploy it
        otokenAddress = VaultLifecycle.getOrDeployOtoken(
            closeParams,
            vaultParams,
            vaultParams.underlying,
            collateralAsset,
            strikePrice,
            expiry,
            false
        );

        // get the black scholes premium of the option and adjust premium based on
        // steth <-> eth exchange rate
        premium = DSMath.wmul(
            GnosisAuction.getOTokenPremium(
                otokenAddress,
                optionsPremiumPricer,
                premiumDiscount
            ),
            IWSTETH(collateralAsset).stEthPerToken()
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
     * @notice Creates the actual Opyn short position by depositing collateral and minting otokens
     * @param gammaController is the address of the opyn controller contract
     * @param marginPool is the address of the opyn margin contract which holds the collateral
     * @param oTokenAddress is the address of the otoken to mint
     * @param depositAmount is the amount of collateral to deposit
     * @return the otoken mint amount
     */
    function createShort(
        address gammaController,
        address marginPool,
        address oTokenAddress,
        uint256 depositAmount
    ) external returns (uint256) {
        IController controller = IController(gammaController);
        uint256 newVaultID =
            (controller.getAccountVaultCounter(address(this))).add(1);

        // An otoken's collateralAsset is the vault's `asset`
        // So in the context of performing Opyn short operations we call them collateralAsset
        IOtoken oToken = IOtoken(oTokenAddress);
        address collateralAsset = oToken.collateralAsset();

        uint256 collateralDecimals =
            uint256(IERC20Detailed(collateralAsset).decimals());
        uint256 mintAmount;

        mintAmount = depositAmount;
        if (collateralDecimals > 8) {
            uint256 scaleBy = 10**(collateralDecimals.sub(8)); // oTokens have 8 decimals
            if (mintAmount > scaleBy) {
                mintAmount = depositAmount.div(scaleBy); // scale down from 10**18 to 10**8
            }
        }

        IERC20 collateralToken = IERC20(collateralAsset);
        collateralToken.safeApprove(marginPool, depositAmount);

        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](3);

        actions[0] = IController.ActionArgs(
            IController.ActionType.OpenVault,
            address(this), // owner
            address(this), // receiver
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
            oTokenAddress, // option address
            newVaultID, // vaultId
            mintAmount, // amount
            0, //index
            "" //data
        );

        controller.operate(actions);

        return mintAmount;
    }

    /**
     * @notice Withdraws stETH + WETH (if necessary) from vault using vault shares
     * @param collateralToken is the address of the collateral token
     * @param weth is the WETH address
     * @param recipient is the recipient
     * @param amount is the withdraw amount in `asset`
     * @return withdrawAmount is the withdraw amount in `collateralToken`
     */
    function withdrawYieldAndBaseToken(
        address collateralToken,
        address weth,
        address recipient,
        uint256 amount
    ) external returns (uint256) {
        IWSTETH collateral = IWSTETH(collateralToken);

        uint256 withdrawAmount = collateral.getWstETHByStETH(amount);

        uint256 yieldTokenBalance =
            withdrawYieldToken(collateralToken, recipient, withdrawAmount);

        // If there is not enough wstETH in the vault, it withdraws as much as possible and
        // transfers the rest in `asset`
        if (withdrawAmount > yieldTokenBalance) {
            withdrawBaseToken(
                collateralToken,
                weth,
                recipient,
                withdrawAmount,
                yieldTokenBalance
            );
        }

        return withdrawAmount;
    }

    /**
     * @notice Withdraws stETH from vault
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
     * @param collateralToken is the address of the collateral token
     * @param weth is the WETH address
     * @param recipient is the recipient
     * @param withdrawAmount is the withdraw amount in terms of yearn tokens
     * @param yieldTokenBalance is the collateral token (stETH) balance of the vault
     */
    function withdrawBaseToken(
        address collateralToken,
        address weth,
        address recipient,
        uint256 withdrawAmount,
        uint256 yieldTokenBalance
    ) internal {
        uint256 underlyingTokensToWithdraw =
            IWSTETH(collateralToken).getStETHByWstETH(
                withdrawAmount.sub(yieldTokenBalance)
            );

        IWETH(weth).deposit{value: underlyingTokensToWithdraw}();
        IERC20(weth).safeTransfer(recipient, underlyingTokensToWithdraw);
    }

    /**
     * @notice Unwraps the necessary amount of the yield-bearing yearn token
     *         and transfers amount to vault
     * @param amount is the amount of `asset` to withdraw
     * @param collateralToken is the address of the collateral token
     * @param crvPool is the address of the steth <-> eth pool on curve
     * @param minETHOut is the minimum eth amount to receive from the swap
     * @return amountETHOut is the amount of eth we have
     available for the withdrawal (may incur curve slippage)
     */
    function unwrapYieldToken(
        uint256 amount,
        address collateralToken,
        address stethToken,
        address crvPool,
        uint256 minETHOut
    ) external returns (uint256) {
        require(
            amount >= minETHOut,
            "Amount withdrawn smaller than minETHOut from swap"
        );

        uint256 assetBalance = address(this).balance;

        uint256 amountETHOut = DSMath.min(assetBalance, amount);

        // We pass in the amount of stETH we want to unwrap from wstETH
        // Though stETH != ETH, we assume that they are equivalent here
        // by passing in the amount of ETH we need to withdraw
        // This assumption is fine because we will be swapping the stETH to ETH.
        uint256 stethNeeded =
            DSMath.max(assetBalance, amount).sub(assetBalance);

        uint256 wstETHPerStETH = IWSTETH(collateralToken).tokensPerStEth();
        uint256 amountToUnwrap = stethNeeded.mul(wstETHPerStETH).div(10**18);

        if (amountToUnwrap > 0) {
            IWSTETH wsteth = IWSTETH(collateralToken);
            IERC20 steth = IERC20(stethToken);

            uint256 startStethBalance = steth.balanceOf(address(this));

            if (stethNeeded > startStethBalance) {
                amountToUnwrap = stethNeeded
                    .sub(startStethBalance)
                    .mul(wstETHPerStETH)
                    .div(10**18);
                // Unwrap to stETH
                wsteth.unwrap(amountToUnwrap);
            }

            // Post-unwrap, the stETH balance will not completely match the stethNeeded
            // due to precision issues.
            // E.g. 0.5 ETH is 499999999999999998 instead of 500000000000000000
            // We just send the entire stETH balance for the swap
            uint256 stETHAmount =
                steth.balanceOf(address(this)).sub(startStethBalance);

            // approve steth exchange
            steth.safeApprove(crvPool, stETHAmount);

            // CRV SWAP HERE from steth -> eth
            // 0 = ETH, 1 = STETH
            // We are setting 1, which is the smallest possible value for the _minAmountOut parameter
            // However it is fine because we check that the amountETHOut >= minETHOut at the end
            // which makes sandwich attacks not possible
            uint256 swappedAmount =
                ICRV(crvPool).exchange(1, 0, stETHAmount, 1);

            amountETHOut = amountETHOut.add(swappedAmount);
        }

        // This revert does not account for the ETH that is already unwrapped
        // Since minETHOut is derived from calling the Curve pool's getter,
        // it reverts in the worst case where the user needs to unwrap and sell
        // 100% of their ETH withdrawal amount
        require(
            amountETHOut >= minETHOut,
            "Output ETH amount smaller than minETHOut"
        );

        return amountETHOut;
    }

    /**
     * @notice Wraps the necessary amount of the base token to the yield-bearing yearn token
     * @param weth is the address of weth
     * @param collateralToken is the address of the collateral token
     */
    function wrapToYieldToken(
        address weth,
        address collateralToken,
        address steth
    ) external {
        // Unwrap all weth premiums transferred to contract
        IWETH wethToken = IWETH(weth);
        uint256 wethBalance = wethToken.balanceOf(address(this));

        if (wethBalance > 0) {
            wethToken.withdraw(wethBalance);
        }

        uint256 ethBalance = address(this).balance;

        IWSTETH collateral = IWSTETH(collateralToken);
        IERC20 stethToken = IERC20(steth);

        if (ethBalance > 0) {
            // Send eth to Lido, recieve steth
            ISTETH(steth).submit{value: ethBalance}(address(this));
        }

        // Get all steth in contract
        uint256 stethBalance = stethToken.balanceOf(address(this));

        if (stethBalance > 0) {
            // approve wrap
            stethToken.safeApprove(collateralToken, stethBalance.add(1));
            // Wrap to wstETH - need to add 1 to steth balance as it is innacurate
            collateral.wrap(stethBalance.add(1));
        }
    }

    /**
     * @notice Helper function to make either an ETH transfer or ERC20 transfer
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(address recipient, uint256 amount) public {
        (bool success, ) = payable(recipient).call{value: amount}("");
        require(success, "!success");
    }
}
