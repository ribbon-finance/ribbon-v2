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

    event Swap(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    function decodePath(
        bytes memory path
    ) internal pure returns (address tokenIn, address tokenOut) {

        (tokenIn, tokenOut, ) = path.decodeFirstPool();
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
    }

    function swap(
        bytes memory path,
        address recipient,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address router
    ) internal returns (uint256 amountOut) {

        ISwapRouter.ExactInputParams memory params =
            ISwapRouter.ExactInputParams({
                recipient: recipient,
                path: path,
                deadline: block.timestamp + 15,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut
            });

        amountOut = ISwapRouter(router).exactInput(params);

        emit Swap(tokenIn, tokenOut, amountIn, amountOut);

        return amountOut;
    }
}