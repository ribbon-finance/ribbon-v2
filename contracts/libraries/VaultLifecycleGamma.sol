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
        uint256 _ratioThreshold;
        uint256 _optionAllocation;
        bytes _usdcWethSwapPath;
        bytes _wethUsdcSwapPath;
    }

    /**
     * @notice Place purchase of options in the queue
     * @param controller controller Squeeth controller
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param vaultId Vault ID of in the controller
     * @param uniswapRouter is the Uniswap Router address
     * @param wethUsdcSwapPath is the WETH -> USDC swap path
     * @param wethBalanceShortage is the amount of WETH shortage to get the vault ready
     * @param usdcBalanceShortage is the amount of USDC shortage to get the vault ready
     * @param usdcBalanceShortageInWETH is the amount of USDC shortage to get the vault ready in WETH terms
     * @param maxAmountIn is the max. amount of WETH allowed when withdrawing from the controller
     */
    struct ReadyParams {
        address controller;
        address sqthWethPool;
        address sqth;
        address weth;
        uint256 vaultId;
        address uniswapRouter;
        bytes wethUsdcSwapPath;
        uint256 wethBalanceShortage;
        uint256 usdcBalanceShortage;
        uint256 usdcBalanceShortageInWETH;
        uint256 maxAmountIn;
    }

    /**
     * @notice Place purchase of options in the queue
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param usdc USDC address
     * @param vaultId Vault ID of in the controller
     * @param lastQueuedWithdrawAmount is amount of pending withdrawal
     * @param totalPending is amount of pending deposit
     * @param uniswapRouter is the Uniswap Router address
     * @param usdcWethSwapPath is the USDC -> WETH swap path
     * @param collateralRatio Target collateral ratio
     * @param minWethAmountOut is the minimum amount of WETH acceptable when swapping the USDC balance
     */
    struct AllocateParams {
        address controller;
        address oracle;
        address sqthWethPool;
        address sqth;
        address weth;
        address usdc;
        uint256 vaultId;
        uint256 lastQueuedWithdrawAmount;
        uint256 totalPending;
        address uniswapRouter;
        bytes usdcWethSwapPath;
        uint256 collateralRatio;
        uint256 minWethAmountOut;
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
     *  ROUTER FUNCTIONS
     ***********************************************/

    /**
     * @notice Check if the path set for swap is valid
     * @param swapPath is the swap path e.g. encodePacked(tokenIn, poolFee, tokenOut)
     * @param validTokenIn is the contract address of the correct tokenIn
     * @param validTokenOut is the contract address of the correct tokenOut
     * @param uniswapFactory is the contract address of UniswapV3 factory
     * @return isValidPath is whether the path is valid
     */
    function checkPath(
        bytes memory swapPath,
        address validTokenIn,
        address validTokenOut,
        address uniswapFactory
    ) external view returns (bool isValidPath) {
        isValidPath = UniswapRouter.checkPath(
            swapPath,
            validTokenIn,
            validTokenOut,
            uniswapFactory
        );

        require(isValidPath, "Invalid path");
    }

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
    ) public returns (uint256 amountOut) {
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
    ) public returns (uint256 amountIn) {
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
    ) public returns (uint256) {
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
    ) public returns (uint256) {
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
     * @notice Place purchase of options in the queue
     * @param readyParams is the struct containing necessary parameters for this function
     * @return wethAmountOut is the amount of WETH received from withdrawing from the controller
     * @return wethAmountIn is the amount of WETH received from swapping USDC
     */
    function prepareReadyState(ReadyParams calldata readyParams)
        external
        returns (uint256 wethAmountOut, uint256 wethAmountIn)
    {
        uint256 wethAmount =
            readyParams.wethBalanceShortage +
                readyParams.usdcBalanceShortageInWETH;

        // Need to check here if we should withdraw from SQTH or swap USDC 
        uint256 sqthAmount =
            calculateSqthBurnAmount(
                readyParams.controller,
                readyParams.vaultId,
                wethAmount
            );

        wethAmountOut = withdrawCollateral(
            readyParams.weth,
            readyParams.sqth,
            readyParams.sqthWethPool,
            sqthAmount,
            readyParams.maxAmountIn,
            wethAmount
        );

        IWETH(readyParams.weth).deposit{value: wethAmountOut}();

        wethAmountIn = swapExactOutput(
            readyParams.weth,
            readyParams.usdcBalanceShortage,
            readyParams.usdcBalanceShortageInWETH,
            readyParams.uniswapRouter,
            readyParams.wethUsdcSwapPath
        );
    }

    /**
     * @notice Place purchase of options in the queue
     * @param allocateParams is the struct containing necessary parameters for this function
     */
    function allocateAvailableBalance(AllocateParams memory allocateParams)
        external
        returns (uint256)
    {
        uint256 currentWethBalance =
            IERC20(allocateParams.weth).balanceOf(address(this));
        uint256 currentUsdcBalance =
            IERC20(allocateParams.usdc).balanceOf(address(this)) -
                allocateParams.lastQueuedWithdrawAmount -
                allocateParams.totalPending;
        require(currentWethBalance != 0 || currentUsdcBalance != 0);

        uint256 wethReceived;
        if (currentUsdcBalance > 0) {
            wethReceived = swapExactInput(
                allocateParams.usdc,
                currentUsdcBalance,
                allocateParams.minWethAmountOut,
                allocateParams.uniswapRouter,
                allocateParams.usdcWethSwapPath
            );
        }

        uint256 sqthMintAmount =
            getSqthMintAmount(
                allocateParams.controller,
                allocateParams.oracle,
                allocateParams.sqthWethPool,
                allocateParams.sqth,
                allocateParams.weth,
                allocateParams.vaultId,
                allocateParams.collateralRatio,
                currentWethBalance +
                    wethReceived +
                    allocateParams.minWethAmountOut
            );

        return
            depositCollateral(
                allocateParams.sqth,
                allocateParams.weth,
                allocateParams.sqthWethPool,
                sqthMintAmount,
                allocateParams.minWethAmountOut,
                currentWethBalance + wethReceived
            );
    }

    /**
     * @notice Rebalance the vault's position
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param vaultId Vault ID of in the controller
     * @param collateralRatio Target collateral ratio
     * @param maxInOrMinOut Maximum in or minimim out depending on the rebalance action
     */
    function rebalance(
        address controller,
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth,
        uint256 vaultId,
        uint256 collateralRatio,
        uint256 maxInOrMinOut
    )
        external
        returns (
            bool isAboveThreshold,
            uint256 sqthAmount,
            uint256 resultAmount
        )
    {
        (isAboveThreshold, sqthAmount) = getRebalanceStatus(
            controller,
            oracle,
            sqthWethPool,
            sqth,
            weth,
            vaultId,
            collateralRatio
        );

        if (isAboveThreshold) {
            resultAmount = withdrawCollateral(
                weth,
                sqth,
                sqthWethPool,
                sqthAmount,
                maxInOrMinOut,
                0
            );
        } else {
            resultAmount = depositCollateral(
                sqth,
                weth,
                sqthWethPool,
                sqthAmount,
                maxInOrMinOut,
                0
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
    ) public view returns (bool, uint256) {
        (uint256 collateralAmount, uint256 shortAmount) =
            getPositionState(controller, vaultId);

        uint256 sqthWethPrice =
            getSqthPriceInWETH(oracle, sqthWethPool, sqth, weth);
        uint256 feeRate = IPowerPerpController(controller).feeRate();

        uint256 feeAdjustment = calculateFeeAdjustment(sqthWethPrice, feeRate);
        uint256 wSqthDelta =
            DSMath.wmul(
                DSMath.wmul(shortAmount, collateralRatio),
                sqthWethPrice
            );

        if (wSqthDelta > collateralAmount) {
            return (
                false,
                DSMath.wdiv(wSqthDelta.sub(collateralAmount), sqthWethPrice)
            );
        } else {
            return (
                true,
                DSMath.wdiv(
                    collateralAmount.sub(wSqthDelta),
                    sqthWethPrice.add(feeAdjustment)
                )
            );
        }
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
    function getSqthPriceInWETH(
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

    /**
     * @notice Calculate SQTH amount to burn for a given amount of WETH
     * @param controller controller Squeeth controller
     * @param vaultId Vault ID
     * @param wethAmount Amount of WETH
     */
    function calculateSqthBurnAmount(
        address controller,
        uint256 vaultId,
        uint256 wethAmount
    ) internal view returns (uint256) {
        (uint256 collateralAmount, uint256 shortAmount) =
            getPositionState(controller, vaultId);

        return shortAmount.mul(collateralAmount).div(wethAmount);
    }

    /**
     * @notice Get the amount of Squeeth to mint
     * @param controller controller Squeeth controller
     * @param oracle Squeeth oracle
     * @param sqthWethPool SQTH WETH Uniswap pool
     * @param sqth SQTH address
     * @param weth WETH address
     * @param vaultId Vault ID
     * @param collateralRatio Squeeth controller collateral ratio
     * @param depositAmount Amount of WETH to deposit
     */
    function getSqthMintAmount(
        address controller,
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth,
        uint256 vaultId,
        uint256 collateralRatio,
        uint256 depositAmount
    ) public view returns (uint256) {
        (uint256 collateralAmount, uint256 shortAmount) =
            getPositionState(controller, vaultId);

        uint256 sqthWethPrice;
        uint256 feeRate;
        {
            sqthWethPrice = IOracle(oracle).getTwap(
                sqthWethPool,
                sqth,
                weth,
                TWAP_PERIOD,
                false
            );
            feeRate = IPowerPerpController(controller).feeRate();
        }

        uint256 feeAdjustment = calculateFeeAdjustment(sqthWethPrice, feeRate);

        if (shortAmount == 0) {
            // Handles situations where the squeeth position has no debt
            // sqthMintAmount = depositAmount * 1e8 / ((sqthWethPrice * collateralRatio / 1e18) + feeAdjustment)
            return
                DSMath.wdiv(
                    depositAmount,
                    DSMath.wmul(sqthWethPrice, collateralRatio).add(
                        feeAdjustment
                    )
                );
        } else {
            // sqthMintAmount = (depositAmount * shortAmount / 1e18) * 1e18
            //                  / (collateralAmount + (shortAmount * feeAdjustment / 1e18))
            return
                DSMath.wdiv(
                    DSMath.wmul(depositAmount, shortAmount),
                    collateralAmount.add(
                        DSMath.wmul(shortAmount, feeAdjustment)
                    )
                );
        }
    }
}
