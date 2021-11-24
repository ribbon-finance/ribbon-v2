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

    struct SwapParams {
        bytes path;
        address recipient;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        address router;    
    }

    event Swap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function decodePath(
        bytes memory path
    ) internal pure returns (address tokenIn, address tokenOut) {
        uint24 fee;

        (tokenIn, tokenOut, fee) = path.decodeFirstPool();
        bool hasMultiplePools = path.hasMultiplePools();

        if (hasMultiplePools) {
            path = path.skipToken();
            while (true) {
                (, tokenOut, ) = path.decodeFirstPool();

                hasMultiplePools = path.hasMultiplePools();

                if (hasMultiplePools) {
                    path = path.skipToken();
                } else {
                    break;
                }
            }
        }

        return (tokenIn, tokenOut);
        // return (address(0), address(0));
    }

    // function getTokenOut(
    //     bytes memory path
    // ) internal pure returns (address tokenOut) {

    //     (, tokenOut, ) = path.decodeFirstPool();
    //     bool hasMultiplePools = path.hasMultiplePools();

    //     if (hasMultiplePools) {
    //         path = path.skipToken();
    //         while (true) {
    //             (, tokenOut, ) = path.decodeFirstPool();

    //             hasMultiplePools = path.hasMultiplePools();

    //             if (hasMultiplePools) {
    //                 path = path.skipToken();
    //             } else {
    //                 break;
    //             }
    //         }
    //     }

    //     return tokenOut;
    // }

    // function checkPath(
    //     bytes memory path,
    //     address _tokenIn,
    //     address _tokenOut
    // ) internal pure returns (bool rightPath) {
    //     (address tokenIn, address tokenOut) = decodePath(path);
    //     return tokenIn == _tokenIn &&
    //         tokenOut == _tokenOut;
    // }

    function swap(
        SwapParams memory swapParams
    ) internal returns (uint256 amountOut) {

        IERC20(swapParams.tokenIn).safeIncreaseAllowance(address(this), swapParams.amountIn);

        ISwapRouter.ExactInputParams memory params =
            ISwapRouter.ExactInputParams({
                recipient: swapParams.recipient,
                path: swapParams.path,
                deadline: block.timestamp + 15,
                amountIn: swapParams.amountIn,
                amountOutMinimum: swapParams.minAmountOut
            });

        amountOut = ISwapRouter(swapParams.router).exactInput(params);
        
        emit Swap(swapParams.tokenIn, swapParams.tokenOut, swapParams.amountIn, amountOut);

        IERC20(swapParams.tokenIn).safeDecreaseAllowance(address(this), swapParams.amountIn);

        return amountOut;
    }
}