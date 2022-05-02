// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {
    IPowerPerpController,
    IOracle
} from "../interfaces/PowerTokenInterface.sol";
import {IController} from "../interfaces/GammaInterface.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {ShareMath} from "./ShareMath.sol";
import {UniswapRouter} from "./UniswapRouter.sol";
import {VaultLib} from "./PowerTokenVaultLib.sol";
import {Vault} from "./Vault.sol";
import {IOptionsPurchaseQueue} from "../interfaces/IOptionsPurchaseQueue.sol";
import {IOptionsPurchaseQueue} from "../interfaces/IOptionsPurchaseQueue.sol";
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";

library VaultLifecycleGamma {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /************************************************
     *  STRUCTS & ENUMS
     ***********************************************/

    struct Deposit {
        uint256 depositAmount;
    }

    struct Withdraw {
        uint256 collateralAmount;
        uint256 shortAmount;
    }

    /**
     * @notice Initialization parameters for the vault.
     * @param _owner is the owner of the vault with critical permissions
     * @param _feeRecipient is the address to recieve vault performance and management fees
     * @param _managementFee is the management fee pct.
     * @param _performanceFee is the perfomance fee pct.
     * @param _tokenName is the name of the token
     * @param _tokenSymbol is the symbol of the token
     * @param _optionsPurchaseQueue is the contract address to reserve options purchase
     * @param _ratioThreshold is the collateral ratio threshold at which the vault is eligible for a rebalancing
     * @param _optionAllocation is the multiplier on the amount to allocate towards the long strangle
     * @param _usdcWethSwapPath is the USDC -> WETH swap path
     * @param _wethUsdcSwapPath is the WETH -> USDC swap path
     */
    struct InitParams {
        address _owner;
        address _keeper;
        address _feeRecipient;
        uint256 _managementFee;
        uint256 _performanceFee;
        string _tokenName;
        string _tokenSymbol;
        address _optionsPurchaseQueue;
        uint256 _ratioThreshold;
        uint256 _optionAllocation;
        bytes _usdcWethSwapPath;
        bytes _wethUsdcSwapPath;
    }

    /**
     * @notice Parameters to run getReadyStateParams
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param usdcWethPool USDC WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param usdc USDC address
     * @param vaultId Vault ID of in the controller
     * @param optionsPurchaseQueue is the options purchase queue contract
     * @param thetaCallVault is Ribbon ETH Call Theta Vault to buy call options from
     * @param thetaPutVault is Ribbon ETH Put Theta Vault to buy put options from
     * @param optionAllocation Option allocation ratio
     * @param lastQueuedWithdrawAmount is amount of withdrawals from the previous round in USDC
     */
    struct ReadyParams {
        address controller;
        address oracle;
        address sqthWethPool;
        address usdcWethPool;
        address sqth;
        address weth;
        address usdc;
        uint256 vaultId;
        address optionsPurchaseQueue;
        address thetaCallVault;
        address thetaPutVault;
        uint256 optionAllocation;
        uint256 lastQueuedWithdrawAmount;
    }

    /// @dev Enum for handling different types of flash swap callbacks
    enum FlashCallback {Deposit, Withdraw, Buy, Sell}

    /************************************************
     *  CONSTANTS
     ***********************************************/

    /// @notice 7 minute twap period for Uniswap V3 pools
    uint32 internal constant TWAP_PERIOD = 420 seconds;

    /// @notice INDEX scale
    uint256 internal constant INDEX_SCALE = 1e4;

    /// @notice ONE
    uint256 internal constant ONE = 1e18;

    /// @notice ONE_ONE
    uint256 internal constant ONE_ONE = 1e36;

    /// @notice The units the collateral ratio is denominated in
    uint256 internal constant COLLATERAL_UNITS = 1e18;

    /// @notice The units the optionallocation ratio is denominated in
    uint256 internal constant OPTIONS_ALLOCATION_UNITS = 1e4;

    /************************************************
     *  VERIFICATION
     ***********************************************/

    /**
     * @notice Verify the constructor params satisfy requirements
     * @param _initParams is the struct with vault initialization parameters
     * @param _vaultParams is the struct with vault general data
     */
    function verifyInitializerParams(
        address usdc,
        address weth,
        address uniswapFactory,
        InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams
    ) external view {
        require(_initParams._owner != address(0), "!owner");
        require(_initParams._keeper != address(0), "!keeper");
        require(_initParams._feeRecipient != address(0), "!feeRecipient");
        require(
            _initParams._performanceFee < 100 * Vault.FEE_MULTIPLIER,
            "performanceFee >= 100%"
        );
        require(
            _initParams._managementFee < 100 * Vault.FEE_MULTIPLIER,
            "managementFee >= 100%"
        );
        require(bytes(_initParams._tokenName).length > 0, "!tokenName");
        require(bytes(_initParams._tokenSymbol).length > 0, "!tokenSymbol");

        require(
            _initParams._optionsPurchaseQueue != address(0),
            "!optionsPurchaseQueue"
        );
        require(_vaultParams.asset != address(0), "!asset");
        require(_vaultParams.underlying != address(0), "!underlying");
        require(_vaultParams.minimumSupply > 0, "!minimumSupply");
        require(_vaultParams.cap > 0, "!cap");
        require(
            _vaultParams.cap > _vaultParams.minimumSupply,
            "cap has to be higher than minimumSupply"
        );
        require(
            _initParams._ratioThreshold != 0 &&
                _initParams._ratioThreshold <
                VaultLifecycleGamma.COLLATERAL_UNITS,
            "!_ratioThreshold"
        );
        require(
            UniswapRouter.checkPath(
                _initParams._usdcWethSwapPath,
                usdc,
                weth,
                uniswapFactory
            ),
            "!_usdcWethSwapPath"
        );
        require(
            UniswapRouter.checkPath(
                _initParams._wethUsdcSwapPath,
                weth,
                usdc,
                uniswapFactory
            ),
            "!_wethUsdcSwapPath"
        );
    }

    /************************************************
     *  SWAPS
     ***********************************************/

    /**
     * @notice Swaps using Uniswap router
     * @param tokenIn Address of input token to swap
     * @param amountIn Amount of input token to swap
     * @param minAmountOut Minimum amount of output token to receive
     * @param uniswapRouter Uniswap router address
     * @param swapPath Path to swap from input token to output token
     * @return amountOut Amount of output token received from the swap
     */
    function swapExactInput(
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address uniswapRouter,
        bytes memory swapPath
    ) external returns (uint256 amountOut) {
        require(amountIn > 0, "!amountIn");
        require(minAmountOut > 0, "!minAmountOut");

        amountOut = UniswapRouter.swapExactInput(
            address(this),
            tokenIn,
            amountIn,
            minAmountOut,
            uniswapRouter,
            swapPath
        );
    }

    /**
     * @notice Swaps using Uniswap router
     * @param tokenIn Address of input token to swap
     * @param amountOut Amount of output token to receive
     * @param maxAmountIn Maximum amount of input token to give
     * @param uniswapRouter Uniswap router address
     * @param swapPath Path to swap from input token to output token
     * @return amountIn Amount of input token given for the swap
     */
    function swapExactOutput(
        address tokenIn,
        uint256 amountOut,
        uint256 maxAmountIn,
        address uniswapRouter,
        bytes memory swapPath
    ) external returns (uint256 amountIn) {
        require(amountIn > 0, "!amountIn");
        require(maxAmountIn > 0, "!maxAmountIn");

        amountIn = UniswapRouter.swapExactOutput(
            address(this),
            tokenIn,
            amountOut,
            maxAmountIn,
            uniswapRouter,
            swapPath
        );
    }

    /************************************************
     *  SQUEETH UTILS
     ***********************************************/

    /**
     * @notice Borrow SQTH to swap into WETH and then deposit the total WETH
     * into the controller to mint SQTH to pay back the initial SQTH
     * @param sqth SQTH address
     * @param weth WETH address
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqthMintAmount SQTH mint amount
     * @param minAmountOut Minimum amount of WETH to receive
     * @param wethAmount Amount of WETH to deposit into SQTH controller
     * @return Amount of output token received from the swap
     */
    function depositCollateral(
        address sqth,
        address weth,
        address sqthWethPool,
        uint256 sqthMintAmount,
        uint256 minAmountOut,
        uint256 wethAmount
    ) external returns (uint256) {
        return
            UniswapRouter.exactInputFlashSwap(
                sqth,
                weth,
                sqthWethPool,
                sqthMintAmount,
                minAmountOut,
                uint8(FlashCallback.Deposit),
                abi.encode(Deposit(wethAmount.add(minAmountOut)))
            );
    }

    /**
     * @notice Borrow WETH to swap into SQTH and then return the SQTH
     * into the controller and collect WETH to pay back the initial WETH
     * @param weth WETH address
     * @param sqth SQTH address
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqthBurnAmount SQTH burn amount
     * @param maxAmountIn Maximum amount of WETH to swap
     * @param wethAmount Amount of collateral to withdraw from the controller
     * @return Amount of input token given for the swap
     */
    function withdrawCollateral(
        address weth,
        address sqth,
        address sqthWethPool,
        uint256 sqthBurnAmount,
        uint256 maxAmountIn,
        uint256 wethAmount
    ) external returns (uint256) {
        return
            UniswapRouter.exactOutputFlashSwap(
                weth,
                sqth,
                sqthWethPool,
                sqthBurnAmount,
                maxAmountIn,
                uint8(FlashCallback.Withdraw),
                abi.encode(Withdraw(wethAmount, sqthBurnAmount))
            );
    }

    /**
     * @notice Either mint SQTH or withdraw WETH from controller to pay
     * back the borrowed amount from Uniswap Pool
     * @param weth WETH address
     * @param sqth SQTH address
     * @param vaultId Vault ID of in the controller
     * @param amountToPay Borrowed amount to pay back
     * @param data Callback data
     */
    function handleCallback(
        address controller,
        address weth,
        address sqth,
        uint256 vaultId,
        uint256 amountToPay,
        bytes calldata data
    ) external {
        UniswapRouter.SwapCallbackData memory callbackData =
            abi.decode(data, (UniswapRouter.SwapCallbackData));

        if (FlashCallback(callbackData.callback) == FlashCallback.Deposit) {
            // Handle deposit
            Deposit memory depositData =
                abi.decode(callbackData.data, (Deposit));

            // Unwrap WETH
            IWETH(weth).withdraw(depositData.depositAmount);

            // Mint SQTH
            IPowerPerpController(controller).mintWPowerPerpAmount{
                value: depositData.depositAmount
            }(vaultId, amountToPay, 0);

            // Send SQTH to Uniswap Pool
            IERC20(sqth).safeTransfer(msg.sender, amountToPay);
        } else if (
            FlashCallback(callbackData.callback) == FlashCallback.Withdraw
        ) {
            // Handle withdrawal
            Withdraw memory withdrawData =
                abi.decode(callbackData.data, (Withdraw));

            // Burn SQTH
            IPowerPerpController(controller).burnWPowerPerpAmount(
                vaultId,
                withdrawData.shortAmount,
                withdrawData.collateralAmount
            );

            // Wrap ETH
            IWETH(weth).deposit{value: amountToPay}();

            // Send WETH to Uniswap Pool
            IERC20(weth).safeTransfer(msg.sender, amountToPay);
        }
    }

    /************************************************
     *  VAULT ROUTINE HELPERS
     ***********************************************/

    /**
     * @notice Place purchase of options in the queue
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param usdc USDC address
     * @param vaultId Vault ID of in the controller
     * @param optionsPurchaseQueue is the options purchase queue contract
     * @param thetaCallVault is Ribbon ETH Call Theta Vault to buy call options from
     * @param thetaPutVault is Ribbon ETH Put Theta Vault to buy put options from
     * @return callOtokens Call options
     * @return putOtokens Put options
     * @return optionsQuantity Quantity of options requested
     */
    function requestPurchase(
        address controller,
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth,
        address usdc,
        uint256 vaultId,
        address optionsPurchaseQueue,
        address thetaCallVault,
        address thetaPutVault,
        uint256 optionAllocation
    )
        external
        returns (
            address callOtokens,
            address putOtokens,
            uint256 optionsQuantity
        )
    {
        (, uint256 vaultBalanceInWeth) =
            getAssetBalances(
                controller,
                oracle,
                sqthWethPool,
                sqth,
                weth,
                usdc,
                vaultId
            );

        optionsQuantity = calculateOptionsQuantity(
            vaultBalanceInWeth,
            optionAllocation
        );

        callOtokens = IRibbonThetaVault(thetaCallVault).currentOption();

        if (callOtokens != address(0)) {
            IOptionsPurchaseQueue(optionsPurchaseQueue).requestPurchase(
                thetaCallVault,
                optionsQuantity
            );
        }

        putOtokens = IRibbonThetaVault(thetaPutVault).currentOption();

        if (putOtokens != address(0)) {
            IOptionsPurchaseQueue(optionsPurchaseQueue).requestPurchase(
                thetaPutVault,
                optionsQuantity
            );
        }
    }

    /**
     * @notice View function to get necessary params to run prepareReadyState function
     * roll to its next position
     * @param readyParams Struct containing necessary parameters to run the function
     * @return wethBalanceShortage Shortage in WETH balance
     * @return usdcBalanceShortage Shortage in USDC balance
     * @return usdcBalanceShortageInWETH Shortage in USDC balance denominated in WETH
     */
    function getReadyStateParams(ReadyParams calldata readyParams)
        external
        view
        returns (
            uint256 wethBalanceShortage,
            uint256 usdcBalanceShortage,
            uint256 usdcBalanceShortageInWETH
        )
    {
        uint256 currentWethBalance =
            IERC20(readyParams.weth).balanceOf(address(this));
        uint256 currentUsdcBalance =
            IERC20(readyParams.usdc).balanceOf(address(this));

        (uint256 vaultBalanceInUSDC, uint256 vaultBalanceInWETH) =
            getAssetBalances(
                readyParams.controller,
                readyParams.oracle,
                readyParams.sqthWethPool,
                readyParams.sqth,
                readyParams.weth,
                readyParams.usdc,
                readyParams.vaultId
            );

        uint256 wethPriceInUSDC =
            getWethPriceInUSDC(
                readyParams.oracle,
                readyParams.usdcWethPool,
                readyParams.weth,
                readyParams.usdc
            );

        uint256 optionsQuantity =
            calculateOptionsQuantity(
                vaultBalanceInWETH +
                    ((vaultBalanceInUSDC * 10**6) / wethPriceInUSDC),
                readyParams.optionAllocation
            );

        uint256 callPriceCeiling =
            IOptionsPurchaseQueue(readyParams.optionsPurchaseQueue)
                .ceilingPrice(readyParams.thetaCallVault);
        require(callPriceCeiling > 0, "Price ceiling for call vault not set");
        uint256 putPriceCeiling =
            IOptionsPurchaseQueue(readyParams.optionsPurchaseQueue)
                .ceilingPrice(readyParams.thetaPutVault);
        require(putPriceCeiling > 0, "Price ceiling for put vault not set");

        uint256 requiredWethBalance =
            (callPriceCeiling * optionsQuantity) / 1e18;

        uint256 requiredUsdcBalance =
            (putPriceCeiling * optionsQuantity) /
                1e18 +
                readyParams.lastQueuedWithdrawAmount;

        wethBalanceShortage = requiredWethBalance > currentWethBalance
            ? requiredWethBalance - currentWethBalance
            : 0;
        usdcBalanceShortage = requiredUsdcBalance > currentUsdcBalance
            ? requiredUsdcBalance - currentUsdcBalance
            : 0;
        usdcBalanceShortageInWETH = usdcBalanceShortage > 0
            ? (usdcBalanceShortage * 10**6) / wethPriceInUSDC
            : 0;
    }

    /**
     * @notice Retrieve rebalance status
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param vaultId Vault ID of in the controller
     * @param collateralRatio Target collateral ratio
     * @return boolean true if rebalance is required
     * @return uint256 amount of SQTH to mint or burn
     */
    function getRebalanceStatus(
        address controller,
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth,
        uint256 vaultId,
        uint256 collateralRatio
    ) external view returns (bool, uint256) {
        (uint256 collateralAmount, uint256 shortAmount) =
            getPositionState(controller, vaultId);

        uint256 sqthWethPrice =
            getSqueethPriceInWETH(oracle, sqthWethPool, sqth, weth);
        uint256 feeRate = IPowerPerpController(controller).feeRate();

        uint256 feeAdjustment = calculateFeeAdjustment(sqthWethPrice, feeRate);
        uint256 wSqueethDelta =
            DSMath.wmul(
                DSMath.wmul(shortAmount, collateralRatio),
                sqthWethPrice
            );

        if (wSqueethDelta > collateralAmount) {
            return (
                false,
                DSMath.wdiv(wSqueethDelta.sub(collateralAmount), sqthWethPrice)
            );
        } else {
            return (
                true,
                DSMath.wdiv(
                    collateralAmount.sub(wSqueethDelta),
                    sqthWethPrice.add(feeAdjustment)
                )
            );
        }
    }

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Get the collateral and debt in the squeeth position
     * @param controller Squeeth controller
     * @param vaultId Vault ID
     * @return collateralAmount Amount of collateral in the position
     * @return shortAmount Amount of squeeth debt in the position
     */
    function getPositionState(address controller, uint256 vaultId)
        public
        view
        returns (uint256, uint256)
    {
        VaultLib.Vault memory vault =
            IPowerPerpController(controller).vaults(vaultId);
        return (vault.collateralAmount, vault.shortAmount);
    }

    /**
     * @notice Get the total balance of the vault in USDC
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param usdcWethPool USDC WETH Uniswap pool
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param usdc USDC address
     * @param vaultId Vault ID
     * @return shortAmount Amount of squeeth debt in the position
     */
    function getTotalBalance(
        address controller,
        address oracle,
        address usdcWethPool,
        address sqthWethPool,
        address sqth,
        address weth,
        address usdc,
        uint256 vaultId
    ) public view returns (uint256) {
        (uint256 usdcBalance, uint256 wethBalance) =
            getAssetBalances(
                controller,
                oracle,
                sqthWethPool,
                sqth,
                weth,
                usdc,
                vaultId
            );

        uint256 usdcWethPrice =
            IOracle(oracle).getTwap(
                usdcWethPool,
                usdc,
                weth,
                TWAP_PERIOD,
                true
            );

        return usdcBalance.add(DSMath.wmul(wethBalance, usdcWethPrice));
    }

    /**
     * @notice Get the total balance of the vault in USDC
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param usdc USDC address
     * @param vaultId Vault ID
     * @return usdcBalance Amount of balance in USDC
     * @return wethBalance Amount of balance in WETH
     */
    function getAssetBalances(
        address controller,
        address oracle,
        address sqthWethPool,
        address weth,
        address sqth,
        address usdc,
        uint256 vaultId
    ) public view returns (uint256 usdcBalance, uint256 wethBalance) {
        uint256 sqthWethPrice =
            IOracle(oracle).getTwap(
                sqthWethPool,
                sqth,
                weth,
                TWAP_PERIOD,
                true
            );
        (uint256 collateralAmount, uint256 shortAmount) =
            getPositionState(controller, vaultId);

        uint256 shortAmountInWeth = DSMath.wmul(shortAmount, sqthWethPrice);
        wethBalance = IERC20(weth).balanceOf(address(this)).add(
            (collateralAmount > shortAmountInWeth)
                ? collateralAmount.sub(shortAmountInWeth)
                : 0
        );
        usdcBalance = IERC20(usdc).balanceOf(address(this));
    }

    /**
     * @notice Get Squeeth price in WETH using TWAP
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     */
    function getSqueethPriceInWETH(
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth
    ) internal view returns (uint256) {
        return
            IOracle(oracle).getTwap(
                sqthWethPool,
                sqth,
                weth,
                TWAP_PERIOD,
                true
            );
    }

    /**
     * @notice Get WETH price in USDC using TWAP
     * @param oracle Squeeth oracle
     * @param usdcWethPool USDC WETH Uniswap pool
     * @param weth WETH address
     * @param usdc USDC address
     */
    function getWethPriceInUSDC(
        address oracle,
        address usdcWethPool,
        address weth,
        address usdc
    ) internal view returns (uint256) {
        return
            IOracle(oracle).getTwap(
                usdcWethPool,
                weth,
                usdc,
                TWAP_PERIOD,
                true
            );
    }

    /************************************************
     *  CALCULATE FUNCTIONS
     ***********************************************/

    /**
     * @notice Calculate the fee adjustment
     * @param sqthWethPrice Squeeth price in WETH
     * @param feeRate feeRate in 4 decimals
     */
    function calculateFeeAdjustment(uint256 sqthWethPrice, uint256 feeRate)
        public
        pure
        returns (uint256)
    {
        return sqthWethPrice.mul(feeRate).div(10000);
    }

    /**
     * @notice Calculate the collateral ratio
     * @param collateralAmount Collateral amount in WETH
     * @param shortAmountInWeth Short amount in WETH
     */
    function calculateCollateralRatio(
        uint256 collateralAmount,
        uint256 shortAmountInWeth
    ) internal pure returns (uint256) {
        return collateralAmount.mul(COLLATERAL_UNITS).div(shortAmountInWeth);
    }

    /**
     * @notice Calculate the option quantity
     * @param balanceInWeth Vault's balance in WETH
     * @param optionAllocation Option allocation ratio
     */
    function calculateOptionsQuantity(
        uint256 balanceInWeth,
        uint256 optionAllocation
    ) internal pure returns (uint256) {
        return
            balanceInWeth.mul(optionAllocation).div(OPTIONS_ALLOCATION_UNITS);
    }
}
