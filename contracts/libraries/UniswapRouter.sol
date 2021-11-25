// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";
import "./Path.sol";

library UniswapRouter {
    using Path for bytes;
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    function checkPath(
        bytes memory swapPath,
        address validTokenIn,
        address validTokenOut
    ) internal pure returns (bool isValidPath) {
        (address tokenIn, address tokenOut, ) = swapPath.decodeFirstPool();

        while (swapPath.hasMultiplePools()) {
            swapPath = swapPath.skipToken();
            (, tokenOut, ) = swapPath.decodeFirstPool();
        }

        return tokenIn == validTokenIn && tokenOut == validTokenOut;
    }

    function swap(
        address recipient,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address router,
        bytes calldata swapPath
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).safeApprove(router, amountIn);

        ISwapRouter.ExactInputParams memory swapParams =
            ISwapRouter.ExactInputParams({
                recipient: recipient,
                path: swapPath,
                deadline: block.timestamp.add(10 minutes),
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            });

        amountOut = ISwapRouter(router).exactInput(swapParams);

        return amountOut;
    }
}
