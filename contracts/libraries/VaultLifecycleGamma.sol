// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

import {IController, IOracle} from "../interfaces/PowerTokenInterface.sol";
import {VaultLib} from "./PowerTokenVaultLib.sol";

library VaultLifecycleGamma {
    using SafeMath for uint256;

    uint32 internal constant TWAP_PERIOD = 420 seconds;
    uint256 internal constant INDEX_SCALE = 1e4;
    uint256 internal constant ONE = 1e18;
    uint256 internal constant ONE_ONE = 1e36;
    uint256 internal constant COLLATERAL_UNITS = 100;

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
