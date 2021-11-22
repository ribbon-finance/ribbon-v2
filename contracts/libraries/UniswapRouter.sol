// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {Vault} from "./Vault.sol";
import {
    IPriceOracle
} from "@ribbon-finance/rvol/contracts/interfaces/IPriceOracle.sol";
import {ISwapRouter} from "../interfaces/ISwapRouter.sol";

library UniswapRouter {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // address internal constant UNISWAP_ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address internal constant WETH = 0xd0A1E359811322d97991E03f863a0C30C2cF029C;

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    /**
     * @notice Swaps stables (USDC) gained from option auction with vault underlying asset
     * @param tokenIn is the contract address for the token given up to swap
     * @param tokenOut is the contract address of the token being acquired
     * @param amountIn is the amount of tokenIn to swap
     * @param slippage is the max. slippage acceptable for the swap
     * @param poolFee is the max. pool fee acceptable for the swap
     * @param _priceOracle is the address of ChainLink oracle for the tokenIn, tokenOut pair
     * @param _uniswapRouter is the address of Uniswapv3 router
     * @return amountOut is the amount of token received from the swap
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 slippage,
        uint256 poolFee,
        address _priceOracle,
        address _uniswapRouter
    ) internal returns (uint256 amountOut) {
        require(tokenIn != address(0), 'tokenIn cannot be the 0 address');
        require(tokenOut != address(0), 'tokenOut cannot be the 0 address');
        require(amountIn > 0, 'amountIn must be larger than 0');
        require(slippage > 0, 'slippage must be larger than 0');
        require(_priceOracle != address(0), 'Oracle cannot be the 0 address');
        require(_uniswapRouter != address(0), 'Router cannot be the 0 address');

        // Increase allowance for swapping
        IERC20(tokenIn).safeIncreaseAllowance(
            _uniswapRouter,
            amountIn
        );
        
        // Use ChainLink oracle to get the latest price
        IPriceOracle priceOracle = IPriceOracle(_priceOracle);
        uint256 priceOracleDecimals = priceOracle.decimals();
        uint256 spotPrice = priceOracle.latestAnswer();

        uint256 assetOracleMultiplier = 
            10 **
                (
                    uint256(18).sub(priceOracleDecimals)
                );

        // Use price information from Oracle to determine minimum output
        uint256 minOut = DSMath.wmul(spotPrice.mul(assetOracleMultiplier), amountIn)
            .mul(1000000 - slippage).div(1000000);

        // Create the params to swap between asset to USDC
        // For most alts, multihop from asset to WETH and WETH to USDC is required
        ISwapRouter.ExactInputParams memory params =
            ISwapRouter.ExactInputParams({
                recipient: address(this),
                path: abi.encodePacked(tokenIn, poolFee, WETH, poolFee, tokenOut), //TBD
                deadline: block.timestamp.add(15 minutes),
                amountIn: amountIn,
                amountOutMinimum: minOut
            });

        // Swap asset with USDC
        amountOut = ISwapRouter(_uniswapRouter).exactInput(params);

        // Remove allowance after swap to guard vault's collateral from potential pool exploits
        IERC20(tokenIn).safeDecreaseAllowance(
            _uniswapRouter,
            amountIn
        );
        
    }
}