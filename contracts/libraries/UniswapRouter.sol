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
     * @notice Check if a Uniswap pool is valid
     * @param tokenA is one of the tokens in the pool
     * @param tokenB is the other token in the pool
     * @param pool is the pool address
     * @param factory is the factory address
     * @return isValidPool is whether the path is valid
     */
    function checkPool(
        address tokenA,
        address tokenB,
        address pool,
        address factory
    ) internal view returns (bool) {
        // Check the factory if the pool exists
        require(
            IUniswapV3Factory(factory).getPool(
                tokenA,
                tokenB,
                IUniswapV3Pool(pool).fee()
            ) == pool,
            "Invalid pool"
        );

        address token0 = IUniswapV3Pool(pool).token0();
        address token1 = IUniswapV3Pool(pool).token1();
        return
            ((tokenA == token0) && (tokenB == token1)) ||
            ((tokenB == token0) && (tokenA == token1));
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
     * @param pool pool address for tokenIn and tokenOut
     * @param amountIn exact amount to sell
     * @param minAmountOut minimum amount to receive
     * @param callback callback function id
     * @param data callback data
     * @return amountOut amount of token received
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

        // Triggers callback on uniswapV3SwapCallback()
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

    /**
     * @notice Single exact output flash swap (specify an exact amount to receive)
     * @param tokenIn token address to sell
     * @param tokenOut token address to receive
     * @param pool pool address for tokenIn and tokenOut
     * @param amountOut exact amount to receive
     * @param maxAmountIn maximum amount to sell
     * @param callback function call source
     * @param data arbitrary data assigned with the call
     * @return amountIn amount of token sold
     */
    function exactOutputFlashSwap(
        address tokenIn,
        address tokenOut,
        address pool,
        uint256 amountOut,
        uint256 maxAmountIn,
        uint8 callback,
        bytes memory data
    ) internal returns (uint256 amountIn) {
        bool zeroForOne = tokenIn < tokenOut;

        // Triggers callback on uniswapV3SwapCallback()
        (int256 amount0Delta, int256 amount1Delta) =
            IUniswapV3Pool(pool).swap(
                address(this),
                zeroForOne,
                -amountOut.toInt256(),
                zeroForOne
                    ? TickMath.MIN_SQRT_RATIO + 1
                    : TickMath.MAX_SQRT_RATIO - 1,
                abi.encode(SwapCallbackData(callback, data))
            );

        // Determine the amountIn and amountOut based on which token has a lower address
        uint256 amountOutReceived;
        (amountIn, amountOutReceived) = zeroForOne
            ? (uint256(amount0Delta), uint256(-amount1Delta))
            : (uint256(amount1Delta), uint256(-amount0Delta));
        // It's technically possible to not receive the full output amount,
        // so if no price limit has been specified, require this possibility away
        require(amountOutReceived == amountOut);

        require(amountIn <= maxAmountIn, "!maxAmountIn");
    }
}
