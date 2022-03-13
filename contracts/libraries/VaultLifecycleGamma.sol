// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IController, IOracle} from "../interfaces/PowerTokenInterface.sol";
import {VaultLib} from "./PowerTokenVaultLib.sol";
import {UniswapRouter} from "./UniswapRouter.sol";

library VaultLifecycleGamma {
    using SafeMath for uint256;

    function getTargetSqueethAmount(
        address controller,
        uint256 vaultId,
        uint256 amount
    ) internal view returns (uint256) {
        VaultLib.Vault memory vault = IController(controller).vaults(vaultId);
        return uint256(vault.shortAmount).mul(amount);
    }

    function getSqueethPrice(
        address oracle,
        address squeethPool,
        address powerPerp,
        address weth
    ) internal view returns (uint256) {
        return IOracle(oracle).getTwap(squeethPool, powerPerp, weth, 0, true);
    }

    /**
     * @notice Swaps tokens using UniswapV3 router
     * @param tokenIn is the token address to swap
     * @param amount is the amount of tokenIn to swap
     * @param minAmountOut is the minimum acceptable amount of tokenOut received from swap
     * @param router is the contract address of UniswapV3 router
     * @param swapPath is the swap path e.g. encodePacked(tokenIn, poolFee, tokenOut)
     */
    function swap(
        address tokenIn,
        uint256 amount,
        uint256 minAmountOut,
        address router,
        bytes calldata swapPath
    ) external {
        if (amount > 0) {
            UniswapRouter.swap(
                address(this),
                tokenIn,
                amount,
                minAmountOut,
                router,
                swapPath
            );
        }
    }

    function checkPath(
        bytes calldata swapPath,
        address validTokenIn,
        address validTokenOut,
        address uniswapFactory
    ) external view returns (bool isValidPath) {
        return
            UniswapRouter.checkPath(
                swapPath,
                validTokenIn,
                validTokenOut,
                uniswapFactory
            );
    }
}
