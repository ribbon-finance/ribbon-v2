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
    enum FlashCallback {DEPOSIT, WITHDRAW, INCREASE, DECREASE}

    struct Deposit {
        uint256 depositAmount;
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
                uint8(FlashCallback.DEPOSIT),
                abi.encode(Deposit(wethAmount.add(minAmountOut)))
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

        if (FlashCallback(callbackData.callback) == FlashCallback.DEPOSIT) {
            Deposit memory depositData =
                abi.decode(callbackData.data, (Deposit));

            IWETH(weth).withdraw(depositData.depositAmount);

            IController(controller).mintWPowerPerpAmount{
                value: depositData.depositAmount
            }(vaultId, amountToPay, 0);

            IERC20(sqth).safeTransfer(msg.sender, amountToPay);
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

    function getSqthMintAmount(
        address controller,
        uint256 wethUsdcPrice,
        uint256 collateralRatio,
        uint256 wethAmount
    ) internal view returns (uint256) {
        uint256 normalizationFactor =
            IController(controller).getExpectedNormalizationFactor();
        uint256 debtValueInWeth =
            wethAmount.mul(COLLATERAL_UNITS).div(collateralRatio);
        return
            debtValueInWeth.mul(ONE_ONE).div(wethUsdcPrice).div(
                normalizationFactor
            );
    }

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

    function getWethPrice(
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

    function getScaledWethPrice(
        address oracle,
        address usdcWethPool,
        address weth,
        address usdc
    ) internal view returns (uint256) {
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
