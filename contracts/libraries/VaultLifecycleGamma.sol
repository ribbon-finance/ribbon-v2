// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {IController, IOracle} from "../interfaces/PowerTokenInterface.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {ShareMath} from "./ShareMath.sol";
import {UniswapRouter} from "./UniswapRouter.sol";
import {VaultLib} from "./PowerTokenVaultLib.sol";

library VaultLifecycleGamma {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    /// @dev Enum for handling different types of flash swap callbacks
    enum FlashCallback {Deposit, Withdraw, Buy, Sell}

    struct Deposit {
        uint256 depositAmount;
    }

    struct Withdraw {
        uint256 collateralAmount;
        uint256 shortAmount;
    }

    /// @notice 7 minute twap period for Uniswap V3 pools
    uint32 internal constant TWAP_PERIOD = 420 seconds;

    /// @notice INDEX scale
    uint256 internal constant INDEX_SCALE = 1e4;

    /// @notice ONE
    uint256 internal constant ONE = 1e18;

    /// @notice ONE_ONE
    uint256 internal constant ONE_ONE = 1e36;

    /// @notice The units the collateral ratio is demominated in
    uint256 internal constant COLLATERAL_UNITS = 1e18;

    /**
     * @notice Swaps pending USDC deposits into WETH
     * @param amountIn Amount of USDC to swap into WETH
     * @param minAmountOut Minimum amount of WETH to receive
     * @return amountOut Amount of WETH received from the swap
     */
    function swapTotalPending(
        address usdc,
        address uniswapRouter,
        bytes memory swapPath,
        uint256 amountIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        require(amountIn > 0, "!amountIn");
        require(minAmountOut > 0, "!minAmountOut");

        // Swap pending USDC deposits to WETH
        amountOut = UniswapRouter.swap(
            address(this),
            usdc,
            amountIn,
            minAmountOut,
            uniswapRouter,
            swapPath
        );
    }

    function depositTotalPending(
        address controller,
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth,
        uint256 vaultId,
        uint256 collateralRatio,
        uint256 wethAmount,
        uint256 minAmountOut
    ) external returns (uint256) {
        require(wethAmount > 0, "!wethAmount");
        require(minAmountOut > 0, "!minAmountOut");

        uint256 sqthMintAmount =
            getSqthMintAmount(
                controller,
                oracle,
                sqthWethPool,
                sqth,
                weth,
                vaultId,
                collateralRatio,
                wethAmount.add(minAmountOut)
            );

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

    function withdrawQueuedShares(
        address controller,
        address sqthWethPool,
        address sqth,
        address weth,
        uint256 vaultId,
        uint256 shares,
        uint256 totalShares,
        uint256 maxAmountIn
    ) external returns (uint256) {
        require(shares > 0, "!shares");
        require(maxAmountIn > 0, "!maxAmountIn");

        (uint256 collateralAmount, uint256 shortAmount) =
            getSqthBurnAmount(controller, vaultId, shares, totalShares);

        return
            UniswapRouter.exactOutputFlashSwap(
                weth,
                sqth,
                sqthWethPool,
                shortAmount,
                maxAmountIn,
                uint8(FlashCallback.Withdraw),
                abi.encode(Withdraw(collateralAmount, shortAmount))
            );
    }

    function processCallback(
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
            Deposit memory depositData =
                abi.decode(callbackData.data, (Deposit));

            IWETH(weth).withdraw(depositData.depositAmount);

            IController(controller).mintWPowerPerpAmount{
                value: depositData.depositAmount
            }(vaultId, amountToPay, 0);

            IERC20(sqth).safeTransfer(msg.sender, amountToPay);
        } else if (
            FlashCallback(callbackData.callback) == FlashCallback.Withdraw
        ) {
            Withdraw memory withdrawData =
                abi.decode(callbackData.data, (Withdraw));

            IController(controller).burnWPowerPerpAmount(
                vaultId,
                withdrawData.shortAmount,
                withdrawData.collateralAmount
            );

            IWETH(weth).deposit{value: amountToPay}();

            IERC20(weth).safeTransfer(msg.sender, amountToPay);
        }
    }

    /// @notice Get the collateral and debt in the squeeth position
    /// @param controller Squeeth controller
    /// @param vaultId Vault ID
    /// @return collateralAmount Amount of collateral in the position
    /// @return shortAmount Amount of squeeth debt in the position
    function getPositionState(address controller, uint256 vaultId)
        public
        view
        returns (uint256, uint256)
    {
        VaultLib.Vault memory vault = IController(controller).vaults(vaultId);
        return (vault.collateralAmount, vault.shortAmount);
    }

    function getSqthRebalanceAmount(
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

        uint256 sqthWethPrice;
        uint256 feeRate;
        {
            sqthWethPrice = IOracle(oracle).getTwap(
                sqthWethPool,
                sqth,
                weth,
                TWAP_PERIOD,
                true
            );
            feeRate = IController(controller).feeRate();
        }

        return
            calculateSqthRebalanceAmount(
                collateralAmount,
                shortAmount,
                collateralRatio,
                sqthWethPrice,
                feeRate
            );
    }

    function calculateSqthRebalanceAmount(
        uint256 collateralAmount,
        uint256 shortAmount,
        uint256 collateralRatio,
        uint256 sqthWethPrice,
        uint256 feeRate
    ) public pure returns (bool, uint256) {
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

    function getSqthBurnAmount(
        address controller,
        uint256 vaultId,
        uint256 shares,
        uint256 totalShares
    ) public view returns (uint256, uint256) {
        (uint256 collateralAmount, uint256 shortAmount) =
            getPositionState(controller, vaultId);
        return (
            collateralAmount.mul(shares).div(totalShares),
            shortAmount.mul(shares).div(totalShares)
        );
    }

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
            feeRate = IController(controller).feeRate();
        }

        return
            calculateSqthMintAmount(
                depositAmount,
                collateralAmount,
                shortAmount,
                collateralRatio,
                sqthWethPrice,
                feeRate
            );
    }

    function calculateSqthMintAmount(
        uint256 depositAmount,
        uint256 collateralAmount,
        uint256 shortAmount,
        uint256 collateralRatio,
        uint256 sqthWethPrice,
        uint256 feeRate
    ) public pure returns (uint256) {
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

    /**
     * @notice Get the squeeth fee adjustment factory
     * @return feeAdjustment the fee adjustment factor
     */
    function getFeeAdjustment(
        address controller,
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth
    ) public view returns (uint256) {
        return
            calculateFeeAdjustment(
                IOracle(oracle).getTwap(
                    sqthWethPool,
                    sqth,
                    weth,
                    TWAP_PERIOD,
                    false
                ),
                IController(controller).feeRate()
            );
    }

    function calculateFeeAdjustment(uint256 sqthWethPrice, uint256 feeRate)
        public
        pure
        returns (uint256)
    {
        return sqthWethPrice.mul(feeRate).div(10000);
    }

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
        uint256 usdcWethPrice =
            IOracle(oracle).getTwap(
                usdcWethPool,
                usdc,
                weth,
                TWAP_PERIOD,
                true
            );
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
        uint256 wethBalance =
            IERC20(weth).balanceOf(address(this)).add(
                (collateralAmount > shortAmountInWeth)
                    ? collateralAmount.sub(shortAmountInWeth)
                    : 0
            );

        return
            IERC20(usdc).balanceOf(address(this)).add(
                DSMath.wmul(wethBalance, usdcWethPrice)
            );
    }

    /************************************************
     *  UTILS
     ***********************************************/

    function getVaultUsdcBalance(
        uint256 wethUsdcPrice,
        uint256 collateralAmount,
        uint256 debtValueInWeth
    ) internal pure returns (uint256) {
        uint256 vaultValueInWeth =
            collateralAmount > debtValueInWeth
                ? collateralAmount.sub(debtValueInWeth)
                : 0;
        return getWethUsdcValue(wethUsdcPrice, vaultValueInWeth);
    }

    function getWethUsdcValue(uint256 wethUsdcPrice, uint256 wethAmount)
        internal
        pure
        returns (uint256)
    {
        return wethAmount.mul(wethUsdcPrice).div(ONE);
    }

    function getVaultPosition(
        address controller,
        uint256 vaultId,
        uint256 wethUsdcPrice
    ) internal view returns (uint256, uint256) {
        VaultLib.Vault memory vault = IController(controller).vaults(vaultId);
        uint256 normalizationFactor =
            IController(controller).getExpectedNormalizationFactor();
        uint256 debtValueInWeth =
            uint256(vault.shortAmount)
                .mul(normalizationFactor)
                .mul(wethUsdcPrice)
                .div(ONE_ONE);
        return (vault.collateralAmount, debtValueInWeth);
    }

    function getCollateralRatio(
        uint256 collateralAmount,
        uint256 debtValueInWeth
    ) internal pure returns (uint256) {
        return collateralAmount.mul(COLLATERAL_UNITS).div(debtValueInWeth);
    }

    function getSqueethPrice(
        address oracle,
        address sqthWethPool,
        address sqth,
        address weth
    ) external view returns (uint256) {
        return
            IOracle(oracle).getTwap(
                sqthWethPool,
                sqth,
                weth,
                TWAP_PERIOD,
                true
            );
    }

    function getWethPrice(
        address oracle,
        address usdcWethPool,
        address weth,
        address usdc
    ) external view returns (uint256) {
        return
            IOracle(oracle).getTwap(
                usdcWethPool,
                weth,
                usdc,
                TWAP_PERIOD,
                true
            );
    }

    function getScaledWethPrice(
        address oracle,
        address usdcWethPool,
        address weth,
        address usdc
    ) external view returns (uint256) {
        uint256 twap =
            IOracle(oracle).getTwap(
                usdcWethPool,
                weth,
                usdc,
                TWAP_PERIOD,
                true
            );
        return twap.div(INDEX_SCALE);
    }
}
