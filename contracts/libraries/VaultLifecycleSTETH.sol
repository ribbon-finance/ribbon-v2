// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultLifecycle} from "../../libraries/VaultLifecycle.sol";
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

    struct CloseParams {
        address OTOKEN_FACTORY;
        address USDC;
        address currentOption;
        uint256 delay;
        uint16 lastStrikeOverrideRound;
        uint256 overriddenStrikePrice;
    }

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
        CloseParams calldata closeParams,
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
            expiry = getNextFriday(block.timestamp);
        } else {
            expiry = getNextFriday(
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
        otokenAddress = getOrDeployOtoken(
            closeParams,
            vaultParams,
            vaultParams.underlying,
            collateralAsset,
            strikePrice,
            expiry
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
        uint256 decimals = vaultParams.decimals;

        newPricePerShare = ShareMath.pricePerShare(
            currentShareSupply,
            currentBalance,
            pendingAmount,
            decimals
        );

        // After closing the short, if the options expire in-the-money
        // vault pricePerShare would go down because vault's asset balance decreased.
        // This ensures that the newly-minted shares do not take on the loss.
        uint256 _mintShares =
            ShareMath.assetToShares(pendingAmount, newPricePerShare, decimals);

        uint256 newSupply = currentShareSupply.add(_mintShares);
        uint256 queuedAmount =
            newSupply > 0
                ? ShareMath.sharesToAsset(
                    vaultState.queuedWithdrawShares,
                    newPricePerShare,
                    decimals
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
        uint256 scaleBy = 10**(collateralDecimals.sub(8)); // oTokens have 8 decimals

        if (mintAmount > scaleBy && collateralDecimals > 8) {
            mintAmount = depositAmount.div(scaleBy); // scale down from 10**18 to 10**8
        }

        // double approve to fix non-compliant ERC20s
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
     * @return performanceFee is the performance fee
     * @return managementFee is the management fee
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
            uint256 performanceFee,
            uint256 managementFee,
            uint256 vaultFee
        )
    {
        uint256 prevLockedAmount = vaultState.lastLockedAmount;
        uint256 totalPending = vaultState.totalPending;

        // Take performance fee and management fee ONLY if difference between
        // last week and this week's vault deposits, taking into account pending
        // deposits and withdrawals, is positive. If it is negative, last week's
        // option expired ITM past breakeven, and the vault took a loss so we
        // do not collect performance fee for last week
        if (currentLockedBalance.sub(totalPending) > prevLockedAmount) {
            performanceFee = currentLockedBalance
                .sub(totalPending)
                .sub(prevLockedAmount)
                .mul(performanceFeePercent)
                .div(100 * 10**6);
            managementFee = currentLockedBalance
                .sub(totalPending)
                .mul(managementFeePercent)
                .div(100 * 10**6);

            vaultFee = performanceFee.add(managementFee);
        }
    }

    /**
     * @notice Either retrieves the option token if it already exists, or deploy it
     * @param closeParams is the struct with details on previous option and strike selection details
     * @param vaultParams is the struct with vault general data
     * @param underlying is the address of the underlying asset of the option
     * @param collateralAsset is the address of the collateral asset of the option
     * @param strikePrice is the strike price of the option
     * @param expiry is the expiry timestamp of the option
     * @return the address of the option
     */
    function getOrDeployOtoken(
        CloseParams calldata closeParams,
        Vault.VaultParams storage vaultParams,
        address underlying,
        address collateralAsset,
        uint256 strikePrice,
        uint256 expiry
    ) internal returns (address) {
        IOtokenFactory factory = IOtokenFactory(closeParams.OTOKEN_FACTORY);

        address otokenFromFactory =
            factory.getOtoken(
                underlying,
                closeParams.USDC,
                collateralAsset,
                strikePrice,
                expiry,
                false
            );

        if (otokenFromFactory != address(0)) {
            return otokenFromFactory;
        }

        address otoken =
            factory.createOtoken(
                underlying,
                closeParams.USDC,
                collateralAsset,
                strikePrice,
                expiry,
                false
            );

        VaultLifecycle.verifyOtoken(
            otoken,
            vaultParams,
            collateralAsset,
            closeParams.USDC,
            closeParams.delay
        );

        return otoken;
    }

    /**
     * @notice Starts the gnosis auction
     * @param auctionDetails is the struct with all the custom parameters of the auction
     * @return the auction id of the newly created auction
     */
    function startAuction(GnosisAuction.AuctionDetails calldata auctionDetails)
        external
        returns (uint256)
    {
        return GnosisAuction.startAuction(auctionDetails);
    }

    /**
     * @notice Verify the constructor params satisfy requirements
     * @param owner is the owner of the vault with critical permissions
     * @param keeper is the keeper of the vault with medium permissions (weekly actions)
     * @param feeRecipient is the address to recieve vault performance and management fees
     * @param performanceFee is the perfomance fee pct.
     * @param tokenName is the name of the token
     * @param tokenSymbol is the symbol of the token
     * @param _vaultParams is the struct with vault general data
     */
    function verifyInitializerParams(
        address owner,
        address keeper,
        address feeRecipient,
        uint256 performanceFee,
        uint256 managementFee,
        string calldata tokenName,
        string calldata tokenSymbol,
        Vault.VaultParams calldata _vaultParams
    ) external pure {
        require(owner != address(0), "!owner");
        require(keeper != address(0), "!keeper");
        require(feeRecipient != address(0), "!feeRecipient");
        require(
            performanceFee < 100 * Vault.FEE_MULTIPLIER,
            "performanceFee >= 100%"
        );
        require(
            managementFee < 100 * Vault.FEE_MULTIPLIER,
            "managementFee >= 100%"
        );
        require(bytes(tokenName).length > 0, "!tokenName");
        require(bytes(tokenSymbol).length > 0, "!tokenSymbol");

        require(_vaultParams.asset != address(0), "!asset");
        require(_vaultParams.underlying != address(0), "!underlying");
        require(_vaultParams.minimumSupply > 0, "!minimumSupply");
        require(_vaultParams.cap > 0, "!cap");
        require(
            _vaultParams.cap > _vaultParams.minimumSupply,
            "cap has to be higher than minimumSupply"
        );
    }

    /**
     * @notice Withdraws stETH + ETH (if necessary) from vault using vault shares
     * @param collateralToken is the address of the collateral token
     * @param recipient is the recipient
     * @param amount is the withdraw amount in `asset`
     * @return withdrawAmount is the withdraw amount in `collateralToken`
     */
    function withdrawYieldAndBaseToken(
        address collateralToken,
        address recipient,
        uint256 amount
    ) external returns (uint256) {
        IWSTETH collateral = IWSTETH(collateralToken);

        uint256 withdrawAmount = collateral.getWstETHByStETH(amount);

        uint256 yieldTokenBalance =
            withdrawYieldToken(collateralToken, recipient, withdrawAmount);

        // If there is not enough wstETH in the vault, it withdraws as much as possible steth
        if (withdrawAmount > yieldTokenBalance) {
            yieldTokenBalance = yieldTokenBalance.add(
                withdrawYieldToken(
                    collateral.stETH(),
                    recipient,
                    withdrawAmount.sub(yieldTokenBalance)
                )
            );
        }

        // If there is not enough stETH or wstETH in the vault, it withdraws as much as possible and
        // transfers the rest in `asset`
        if (withdrawAmount > yieldTokenBalance) {
            withdrawBaseToken(
                collateralToken,
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
     * @param recipient is the recipient
     * @param withdrawAmount is the withdraw amount in terms of yearn tokens
     * @param yieldTokenBalance is the collateral token (stETH) balance of the vault
     */
    function withdrawBaseToken(
        address collateralToken,
        address recipient,
        uint256 withdrawAmount,
        uint256 yieldTokenBalance
    ) internal {
        uint256 underlyingTokensToWithdraw =
            IWSTETH(collateralToken).getStETHByWstETH(
                withdrawAmount.sub(yieldTokenBalance)
            );

        transferAsset(payable(recipient), underlyingTokensToWithdraw);
    }

    /**
     * @notice Unwraps the necessary amount of the yield-bearing yearn token
     *         and transfers amount to vault
     * @param amount is the amount of `asset` to withdraw
     * @param collateralToken is the address of the collateral token
     * @param crvPool is the address of the steth <-> eth pool on curve
     * @param minETHOut is the min eth to recieve
     * @return amountETHOut is the amount of eth we have
     available for the withdrawal (may incur curve slippage)
     */
    function unwrapYieldToken(
        uint256 amount,
        address collateralToken,
        address crvPool,
        uint256 minETHOut
    ) external returns (uint256) {
        uint256 assetBalance = address(this).balance;

        uint256 amountETHOut = DSMath.min(assetBalance, amount);

        uint256 amountToUnwrap =
            IWSTETH(collateralToken).getWstETHByStETH(
                DSMath.max(assetBalance, amount).sub(assetBalance)
            );

        if (amountToUnwrap > 0) {
            IWSTETH wsteth = IWSTETH(collateralToken);
            // Unrap to stETH
            wsteth.unwrap(amountToUnwrap);

            // approve steth exchange
            IERC20(wsteth.stETH()).safeApprove(crvPool, amountToUnwrap);

            // CRV SWAP HERE from steth -> eth
            // 0 = ETH, 1 = STETH
            amountETHOut = amountETHOut.add(
                ICRV(crvPool).exchange(1, 0, amountToUnwrap, minETHOut)
            );
        }

        return amountETHOut;
    }

    /**
     * @notice Wraps the necessary amount of the base token to the yield-bearing yearn token
     * @param weth is the address of weth
     * @param collateralToken is the address of the collateral token
     */
    function wrapToYieldToken(address weth, address collateralToken) external {
        // Unwrap all weth premiums transferred to contract
        IWETH wethToken = IWETH(weth);
        uint256 wethBalance = wethToken.balanceOf(address(this));

        if (wethBalance > 0) {
            wethToken.withdraw(wethBalance);
        }

        uint256 ethBalance = address(this).balance;

        IWSTETH collateral = IWSTETH(collateralToken);
        ISTETH stethToken = ISTETH(collateral.stETH());

        if (ethBalance > 0) {
            // Send eth to Lido, recieve steth
            stethToken.submit{value: ethBalance}(address(this));
        }

        // Get all steth in contract
        uint256 stethBalance = stethToken.balanceOf(address(this));

        if (stethBalance > 0) {
            // approve wrap
            IERC20(address(stethToken)).safeApprove(
                collateralToken,
                stethBalance.add(1)
            );
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

    /**
     * @notice Gets the next options expiry timestamp
     * @param currentExpiry is the expiry timestamp of the current option
     * Reference: https://codereview.stackexchange.com/a/33532
     * Examples:
     * getNextFriday(week 1 thursday) -> week 1 friday
     * getNextFriday(week 1 friday) -> week 2 friday
     * getNextFriday(week 1 saturday) -> week 2 friday
     */
    function getNextFriday(uint256 currentExpiry)
        internal
        pure
        returns (uint256)
    {
        // dayOfWeek = 0 (sunday) - 6 (saturday)
        uint256 dayOfWeek = ((currentExpiry / 1 days) + 4) % 7;
        uint256 nextFriday = currentExpiry + ((7 + 5 - dayOfWeek) % 7) * 1 days;
        uint256 friday8am = nextFriday - (nextFriday % (24 hours)) + (8 hours);

        // If the passed currentExpiry is day=Friday hour>8am, we simply increment it by a week to next Friday
        if (currentExpiry >= friday8am) {
            friday8am += 7 days;
        }
        return friday8am;
    }
}
