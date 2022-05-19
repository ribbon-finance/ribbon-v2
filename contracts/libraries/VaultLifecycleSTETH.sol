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
import {
    IOtokenFactory,
    IOtoken,
    IController,
    GammaTypes
} from "../interfaces/GammaInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {IOptionsPremiumPricer} from "../interfaces/IRibbon.sol";

library VaultLifecycleSTETH {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /**
     * @notice Sets the next option the vault will be shorting, and calculates its premium for the auction
     * @param closeParams is the struct with details on previous option and strike selection details
     * @param vaultParams is the struct with vault general data
     * @param vaultState is the struct with vault accounting state
     * @param collateralAsset is the address of the collateral asset
     * @return otokenAddress is the address of the new option
     * @return strikePrice is the strike price of the new option
     * @return delta is the delta of the new option
     */
    function commitAndClose(
        VaultLifecycle.CloseParams calldata closeParams,
        Vault.VaultParams storage vaultParams,
        Vault.VaultState storage vaultState,
        address collateralAsset
    )
        external
        returns (
            address otokenAddress,
            uint256 strikePrice,
            uint256 delta
        )
    {
        uint256 expiry =
            VaultLifecycle.getNextExpiry(closeParams.currentOption);

        IStrikeSelection selection =
            IStrikeSelection(closeParams.strikeSelection);

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

        return (otokenAddress, strikePrice, delta);
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
     * @notice Unwraps the necessary amount of the wstETH token
     *         and transfers ETH amount to vault
     * @param amount is the amount of ETH to withdraw
     * @param wstEth is the address of wstETH
     * @param stethToken is the address of stETH
     * @param crvPool is the address of the steth <-> eth pool on curve
     * @param minETHOut is the minimum eth amount to receive from the swap
     * @return amountETHOut is the amount of eth unwrapped
     available for the withdrawal (may incur curve slippage)
     */
    function unwrapYieldToken(
        uint256 amount,
        address wstEth,
        address stethToken,
        address crvPool,
        uint256 minETHOut
    ) external returns (uint256) {
        require(
            amount >= minETHOut,
            "Amount withdrawn smaller than minETHOut from swap"
        );
        require(
            minETHOut.mul(10**18).div(amount) >= 0.95 ether,
            "Slippage on minETHOut too high"
        );

        uint256 ethBalance = address(this).balance;
        IERC20 steth = IERC20(stethToken);
        uint256 stethBalance = steth.balanceOf(address(this));

        // 3 different success scenarios
        // Scenario 1. We hold enough ETH to satisfy withdrawal. Send it out directly
        // Scenario 2. We hold enough wstETH to satisy withdrawal. Unwrap then swap
        // Scenario 3. We hold enough ETH + stETH to satisfy withdrawal. Do a swap

        // Scenario 1
        if (ethBalance >= amount) {
            return amount;
        }

        // Scenario 2
        stethBalance = unwrapWstethForWithdrawal(
            wstEth,
            steth,
            ethBalance,
            stethBalance,
            amount,
            minETHOut
        );

        // Scenario 3
        // Now that we satisfied the ETH + stETH sum, we swap the stETH amounts necessary
        // to facilitate a withdrawal

        // This won't underflow since we already asserted that ethBalance < amount before this
        uint256 stEthAmountToSwap =
            DSMath.min(amount.sub(ethBalance), stethBalance);

        uint256 ethAmountOutFromSwap =
            swapStEthToEth(steth, crvPool, stEthAmountToSwap);

        uint256 totalETHOut = ethBalance.add(ethAmountOutFromSwap);

        // Since minETHOut is derived from calling the Curve pool's getter,
        // it reverts in the worst case where the user needs to unwrap and sell
        // 100% of their ETH withdrawal amount
        require(
            totalETHOut >= minETHOut,
            "Output ETH amount smaller than minETHOut"
        );

        return totalETHOut;
    }

    /**
     * @notice Unwraps the required amount of wstETH to a target ETH amount
     * @param wstEthAddress is the address for wstETH
     * @param steth is the ERC20 of stETH
     * @param startStEthBalance is the starting stETH balance used to determine how much more to unwrap
     * @param ethAmount is the ETH amount needed for the contract
     * @param minETHOut is the ETH amount but adjusted for slippage
     * @return the new stETH balance
     */
    function unwrapWstethForWithdrawal(
        address wstEthAddress,
        IERC20 steth,
        uint256 ethBalance,
        uint256 startStEthBalance,
        uint256 ethAmount,
        uint256 minETHOut
    ) internal returns (uint256) {
        uint256 ethstEthSum = ethBalance.add(startStEthBalance);

        if (ethstEthSum < minETHOut) {
            uint256 stethNeededFromUnwrap = ethAmount.sub(ethstEthSum);
            IWSTETH wstEth = IWSTETH(wstEthAddress);
            uint256 wstAmountToUnwrap =
                wstEth.getWstETHByStETH(stethNeededFromUnwrap);

            wstEth.unwrap(wstAmountToUnwrap);

            uint256 newStEthBalance = steth.balanceOf(address(this));
            require(
                ethBalance.add(newStEthBalance) >= minETHOut,
                "Unwrapping wstETH did not return sufficient stETH"
            );
            return newStEthBalance;
        }
        return startStEthBalance;
    }

    /**
     * @notice Swaps from stEth to ETH on the Lido Curve pool
     * @param steth is the address for the Lido staked ether
     * @param crvPool is the Curve pool address to do the swap
     * @param stEthAmount is the stEth amount to be swapped to Ether
     * @return ethAmountOutFromSwap is the returned ETH amount from swap
     */
    function swapStEthToEth(
        IERC20 steth,
        address crvPool,
        uint256 stEthAmount
    ) internal returns (uint256) {
        steth.safeApprove(crvPool, stEthAmount);

        // CRV SWAP HERE from steth -> eth
        // 0 = ETH, 1 = STETH
        // We are setting 1, which is the smallest possible value for the _minAmountOut parameter
        // However it is fine because we check that the totalETHOut >= minETHOut at the end
        // which makes sandwich attacks not possible
        uint256 ethAmountOutFromSwap =
            ICRV(crvPool).exchange(1, 0, stEthAmount, 1);

        return ethAmountOutFromSwap;
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
     * @notice Gets stETH for direct stETH withdrawals, converts wstETH/ETH to stETH if not enough stETH
     * @param steth is the address of steth
     * @param wstEth is the address of wsteth
     * @param amount is the amount to withdraw
     * @return amount of stETH to transfer to the user, this is to account for rounding errors when unwrapping wstETH
     */
    function withdrawStEth(
        address steth,
        address wstEth,
        uint256 amount
    ) external returns (uint256) {
        // 3 different scenarios for withdrawing stETH directly
        // Scenario 1. We hold enough stETH to satisfy withdrawal. Send it out directly
        // Scenario 2. We hold enough stETH + wstETH to satisy withdrawal. Unwrap wstETH then send it
        // Scenario 3. We hold enough stETH + wstETH + ETH satisfy withdrawal. Unwrap wstETH, wrap ETH then send it
        uint256 _amount = amount;
        uint256 stethBalance = IERC20(steth).balanceOf(address(this));
        if (stethBalance >= amount) {
            // Can send out the stETH directly
            return amount; // We return here if we have enough stETH to satisfy the withdrawal
        } else {
            // If amount > stethBalance, send out the entire stethBalance and check wstETH and ETH
            amount = amount.sub(stethBalance);
        }
        uint256 wstethBalance = IWSTETH(wstEth).balanceOf(address(this));
        uint256 totalShares = ISTETH(steth).getTotalShares();
        uint256 totalPooledEther = ISTETH(steth).getTotalPooledEther();
        stethBalance = wstethBalance.mul(totalPooledEther).div(totalShares);
        if (stethBalance >= amount) {
            wstethBalance = amount.mul(totalShares).div(totalPooledEther);
            // Avoids reverting if unwrap amount is 0
            if (wstethBalance > 0) {
                // Unwraps wstETH and sends out the received stETH directly
                IWSTETH(wstEth).unwrap(wstethBalance);
                // Accounts for rounding errors when unwrapping wstETH, this is safe because this function would've
                // returned already if the stETH balance was greater than our withdrawal amount
                return IERC20(steth).balanceOf(address(this)); // We return here if we have enough stETH + wstETH
            }
        } else if (stethBalance > 0) {
            stethBalance = IERC20(steth).balanceOf(address(this));
            IWSTETH(wstEth).unwrap(wstethBalance);
            // Accounts for rounding errors when unwrapping wstETH
            amount = amount.sub(
                IERC20(steth).balanceOf(address(this)).sub(stethBalance)
            );
        }
        // Wrap ETH to stETH if we don't have enough stETH + wstETH
        uint256 ethBalance = address(this).balance;
        if (amount > 0 && ethBalance >= amount) {
            ISTETH(steth).submit{value: amount}(address(this));
        } else if (ethBalance > 0) {
            ISTETH(steth).submit{value: ethBalance}(address(this));
        }
        stethBalance = IERC20(steth).balanceOf(address(this));
        // Accounts for rounding errors by a margin of 3 wei
        require(_amount.add(3) >= stethBalance, "Unwrapped too much stETH");
        require(_amount <= stethBalance.add(3), "Unwrapped insufficient stETH");
        return stethBalance; // We return here if we have enough stETH + wstETH + ETH
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

    function getOTokenPremium(
        address oTokenAddress,
        address optionsPremiumPricer,
        uint256 premiumDiscount,
        address collateralToken
    ) external view returns (uint256) {
        return
            _getOTokenPremium(
                oTokenAddress,
                optionsPremiumPricer,
                premiumDiscount,
                collateralToken
            );
    }

    function _getOTokenPremium(
        address oTokenAddress,
        address optionsPremiumPricer,
        uint256 premiumDiscount,
        address collateralToken
    ) internal view returns (uint256) {
        IOtoken newOToken = IOtoken(oTokenAddress);
        IOptionsPremiumPricer premiumPricer =
            IOptionsPremiumPricer(optionsPremiumPricer);

        // Apply black-scholes formula (from rvol library) to option given its features
        // and get price for 100 contracts denominated in the underlying asset for call option
        // and USDC for put option
        uint256 optionPremium =
            premiumPricer.getPremium(
                newOToken.strikePrice(),
                newOToken.expiryTimestamp(),
                newOToken.isPut()
            );

        // Apply a discount to incentivize arbitraguers
        optionPremium = optionPremium.mul(premiumDiscount).div(
            100 * Vault.PREMIUM_DISCOUNT_MULTIPLIER
        );

        // get the black scholes premium of the option and adjust premium based on
        // steth <-> eth exchange rate
        uint256 adjustedPremium =
            DSMath.wmul(
                optionPremium,
                IWSTETH(collateralToken).stEthPerToken()
            );

        require(
            adjustedPremium <= type(uint96).max,
            "adjustedPremium > type(uint96) max value!"
        );
        require(adjustedPremium > 0, "!adjustedPremium");

        return adjustedPremium;
    }
}
