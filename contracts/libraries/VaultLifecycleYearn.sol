// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {DSMath} from "../vendor/DSMathLib.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Vault} from "./Vault.sol";
import {IYearnVault} from "../interfaces/IYearn.sol";
import {IWETH} from "../interfaces/IWETH.sol";
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
import {SupportsNonCompliantERC20} from "./SupportsNonCompliantERC20.sol";

library VaultLifecycleYearn {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using SupportsNonCompliantERC20 for IERC20;

    struct CloseParams {
        address OTOKEN_FACTORY;
        address USDC;
        address currentOption;
        uint256 delay;
        uint256 lastStrikeOverride;
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
        Vault.VaultParams calldata vaultParams,
        Vault.VaultState calldata vaultState,
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
        (strikePrice, delta) = closeParams.lastStrikeOverride ==
            vaultState.round
            ? (closeParams.overriddenStrikePrice, selection.delta())
            : selection.getStrikePrice(expiry, vaultParams.isPut);

        require(strikePrice != 0, "!strikePrice");

        // retrieve address if option already exists, or deploy it
        otokenAddress = getOrDeployOtoken(
            closeParams.OTOKEN_FACTORY,
            vaultParams.underlying,
            closeParams.USDC,
            collateralAsset,
            strikePrice,
            expiry,
            vaultParams.isPut
        );

        verifyOtoken(
            otokenAddress,
            vaultParams,
            collateralAsset,
            closeParams.USDC,
            closeParams.delay
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
    }

    /**
     * @notice Verify the otoken has the correct parameters to prevent vulnerability to opyn contract changes
     * @param otokenAddress is the address of the otoken
     * @param vaultParams is the struct with vault general data
     * @param collateralAsset is the address of the collateral asset
     * @param USDC is the address of usdc
     * @param delay is the delay between commitAndClose and rollToNextOption
     */
    function verifyOtoken(
        address otokenAddress,
        Vault.VaultParams calldata vaultParams,
        address collateralAsset,
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
            otoken.collateralAsset() == collateralAsset,
            "Wrong collateralAsset"
        );

        // we just assume all options use USDC as the strike
        require(otoken.strikeAsset() == USDC, "strikeAsset != USDC");

        uint256 readyAt = block.timestamp.add(delay);
        require(otoken.expiryTimestamp() >= readyAt, "Expiry before delay");
    }

    /**
     * @notice Calculate the shares to mint, new price per share, and
      amount of funds to re-allocate as collateral for the new round
     * @param currentSupply is the total supply of shares
     * @param currentBalance is the total balance of the vault
     * @param vaultParams is the struct with vault general data
     * @param vaultState is the struct with vault accounting state
     * @return newLockedAmount is the amount of funds to allocate for the new round
     * @return queuedWithdrawAmount is the amount of funds set aside for withdrawal
     * @return newPricePerShare is the price per share of the new round
     * @return mintShares is the amount of shares to mint from deposits
     */
    function rollover(
        uint256 currentSupply,
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
        uint256 roundStartBalance = currentBalance.sub(pendingAmount);

        uint256 singleShare = 10**uint256(vaultParams.decimals);

        newPricePerShare = getPPS(
            currentSupply,
            roundStartBalance,
            singleShare
        );

        // After closing the short, if the options expire in-the-money
        // vault pricePerShare would go down because vault's asset balance decreased.
        // This ensures that the newly-minted shares do not take on the loss.
        uint256 _mintShares =
            pendingAmount.mul(singleShare).div(newPricePerShare);

        uint256 newSupply = currentSupply.add(_mintShares);

        uint256 queuedAmount =
            newSupply > 0
                ? uint256(vaultState.queuedWithdrawShares)
                    .mul(currentBalance)
                    .div(newSupply)
                : 0;

        return (
            currentBalance.sub(queuedAmount),
            queuedAmount,
            newPricePerShare,
            _mintShares
        );
    }

    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/Otoken.sol#L70
    uint256 private constant OTOKEN_DECIMALS = 10**8;

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

        IOtoken oToken = IOtoken(oTokenAddress);
        address collateralAsset = oToken.collateralAsset();

        uint256 collateralDecimals =
            uint256(IERC20Detailed(collateralAsset).decimals());
        uint256 mintAmount;

        if (oToken.isPut()) {
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
            mintAmount = depositAmount
                .mul(OTOKEN_DECIMALS)
                .mul(10**18) // we use 10**18 to give extra precision
                .div(oToken.strikePrice().mul(10**(10 + collateralDecimals)));
        } else {
            mintAmount = depositAmount;
            uint256 scaleBy = 10**(collateralDecimals.sub(8)); // oTokens have 8 decimals

            if (mintAmount > scaleBy && collateralDecimals > 8) {
                mintAmount = depositAmount.div(scaleBy); // scale down from 10**18 to 10**8
            }
        }

        // double approve to fix non-compliant ERC20s
        IERC20 collateralToken = IERC20(collateralAsset);
        collateralToken.doubleApprove(marginPool, depositAmount);

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
     * @notice Close the existing short otoken position. Currently this implementation is simple.
     * It closes the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time. Since calling `_closeShort` deletes vaults by
     calling SettleVault action, this assumption should hold.
     * @param gammaController is the address of the opyn controller contract
     * @return amount of collateral redeemed from the vault
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
     * @notice Either retrieves the option token if it already exists, or deploy it
     * @param otokenFactory is the address of the opyn factory contract with option token blueprint
     * @param underlying is the address of the underlying asset of the option
     * @param collateralAsset is the address of the collateral asset of the option
     * @param strikePrice is the strike price of the option
     * @param expiry is the expiry timestamp of the option
     * @param isPut is whether the option is a put
     * @return the address of the option
     */
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
    function verifyConstructorParams(
        address owner,
        address keeper,
        address feeRecipient,
        uint256 performanceFee,
        string calldata tokenName,
        string calldata tokenSymbol,
        Vault.VaultParams calldata _vaultParams
    ) external pure {
        require(owner != address(0), "!owner");
        require(keeper != address(0), "!keeper");
        require(feeRecipient != address(0), "!feeRecipient");
        require(performanceFee < 100 * 10**6, "Invalid performance fee");
        require(bytes(tokenName).length > 0, "!tokenName");
        require(bytes(tokenSymbol).length > 0, "!tokenSymbol");

        require(_vaultParams.asset != address(0), "!asset");
        require(_vaultParams.underlying != address(0), "!underlying");
        require(_vaultParams.minimumSupply > 0, "!minimumSupply");
        require(_vaultParams.cap > 0, "!cap");
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
    ) external returns (uint256 withdrawAmount) {
        uint256 pricePerYearnShare =
            IYearnVault(collateralToken).pricePerShare();
        withdrawAmount = DSMath.wdiv(
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
    ) internal returns (uint256 yieldTokenBalance) {
        IERC20 collateral = IERC20(collateralToken);

        yieldTokenBalance = collateral.balanceOf(address(this));
        uint256 yieldTokensToWithdraw =
            DSMath.min(yieldTokenBalance, withdrawAmount);
        if (yieldTokensToWithdraw > 0) {
            collateral.safeTransfer(recipient, yieldTokensToWithdraw);
        }
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
     * @notice Helper function to make either an ETH transfer or ERC20 transfer
     * @param weth is the weth address
     * @param asset is the vault asset address
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(
        address weth,
        address asset,
        address payable recipient,
        uint256 amount
    ) public {
        if (asset == weth) {
            IWETH(weth).withdraw(amount);
            (bool success, ) = recipient.call{value: amount}("");
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

    function getPPS(
        uint256 currentSupply,
        uint256 roundStartBalance,
        uint256 singleShare
    ) internal pure returns (uint256 newPricePerShare) {
        newPricePerShare = currentSupply > 0
            ? singleShare.mul(roundStartBalance).div(currentSupply)
            : singleShare;
    }
}
