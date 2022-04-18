// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IUniswapV3Factory
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import {
    IUniswapV3Pool
} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {
    ISwapRouter
} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {TickMath} from "./TickMath.sol";
import {Path} from "./Path.sol";

library UniswapRouter {
    using Path for bytes;
    using SafeCast for uint256;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    struct SwapCallbackData {
        uint8 callback;
        bytes data;
    }

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
    ) internal view returns (bool isValidPath) {
        // Function checks if the tokenIn and tokenOut in the swapPath
        // matches the validTokenIn and validTokenOut specified.
        address tokenIn;
        address tokenOut;
        address tempTokenIn;
        uint24 fee;
        IUniswapV3Factory factory = IUniswapV3Factory(uniswapFactory);

        // Return early if swapPath is below the bare minimum (43)
        require(swapPath.length >= 43, "Path too short");
        // Return early if swapPath is above the max (66)
        // At worst we have 2 hops e.g. USDC > WETH > asset
        require(swapPath.length <= 66, "Path too long");

        // Decode the first pool in path
        (tokenIn, tokenOut, fee) = swapPath.decodeFirstPool();

        // Check to factory if pool exists
        require(
            factory.getPool(tokenIn, tokenOut, fee) != address(0),
            "Pool does not exist"
        );

        // Check next pool if multiple pools
        while (swapPath.hasMultiplePools()) {
            // Remove the first pool from path
            swapPath = swapPath.skipToken();
            // Check the next pool and update tokenOut
            (tempTokenIn, tokenOut, fee) = swapPath.decodeFirstPool();

            require(
                factory.getPool(tokenIn, tokenOut, fee) != address(0),
                "Pool does not exist"
            );
        }

        return tokenIn == validTokenIn && tokenOut == validTokenOut;
    }

    /**
     * @notice Swaps assets by calling UniswapV3 router
     * @param recipient is the address of recipient of the tokenOut
     * @param tokenIn is the address of the token given to the router
     * @param amountIn is the amount of tokenIn given to the router
     * @param minAmountOut is the minimum acceptable amount of tokenOut received from swap
     * @param router is the contract address of UniswapV3 router
     * @param swapPath is the swap path e.g. encodePacked(tokenIn, poolFee, tokenOut)
     * @return amountOut is the amount of tokenOut received from the swap
     */
    function swap(
        address recipient,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address router,
        bytes memory swapPath
    ) internal returns (uint256 amountOut) {
        // Approve router to spend tokenIn
        IERC20(tokenIn).safeApprove(router, amountIn);

        // Swap assets using UniswapV3 router
        ISwapRouter.ExactInputParams memory swapParams =
            ISwapRouter.ExactInputParams({
                recipient: recipient,
                path: swapPath,
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            });

        amountOut = ISwapRouter(router).exactInput(swapParams);

        return amountOut;
    }

    /**
     * @notice Single exact input flash swap (specify an exact amount to pay)
     * @param tokenIn token address to sell
     * @param tokenOut token address to receive
     * @param amountIn amount to sell
     * @param minAmountOut minimum amount to receive
     * @param callback callback function id
     * @param data callback data
     */
    function exactInputFlashSwap(
        address tokenIn,
        address tokenOut,
        address pool,
        uint256 amountIn,
        uint256 minAmountOut,
        uint8 callback,
        bytes memory data
    ) internal returns (uint256 amountOut) {
        bool zeroForOne = tokenIn < tokenOut;

        //swap on uniswap, including data to trigger call back for flashswap
        (int256 amount0, int256 amount1) =
            IUniswapV3Pool(pool).swap(
                address(this),
                zeroForOne,
                amountIn.toInt256(),
                zeroForOne
                    ? TickMath.MIN_SQRT_RATIO + 1
                    : TickMath.MAX_SQRT_RATIO - 1,
                abi.encode(SwapCallbackData(callback, data))
            );

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));

        require(amountOut >= minAmountOut, "!minAmountOut");
    }
}
