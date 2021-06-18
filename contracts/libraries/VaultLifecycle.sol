// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {Vault} from "./Vault.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {
    IStrikeSelection,
    IOptionsPremiumPricer
} from "../interfaces/IRibbon.sol";
import {GammaProtocol} from "../protocols/GammaProtocol.sol";
import {GnosisAuction} from "../protocols/GnosisAuction.sol";

library VaultLifecycle {
    using SafeMath for uint256;

    struct CloseParams {
        address OTOKEN_FACTORY;
        address USDC;
        address currentOption;
        uint256 delay;
        uint256 overridenStrikePrice;
    }

    function commitAndClose(
        CloseParams calldata closeParams,
        Vault.VaultParams calldata vaultParams,
        Vault.VaultState calldata vaultState
    )
        external
        returns (
            address otokenAddress,
            uint256 premium,
            uint256 strikePrice,
            uint256 delta
        )
    {
        uint256 expiry;

        // uninitialized state
        if (closeParams.currentOption <= address(1)) {
            expiry = GammaProtocol.getNextFriday(block.timestamp);
        } else {
            expiry = GammaProtocol.getNextFriday(
                IOtoken(closeParams.currentOption).expiryTimestamp()
            );
        }

        IStrikeSelection selection =
            IStrikeSelection(vaultParams.strikeSelection);

        (strikePrice, delta) = vaultState.lastStrikeOverride == vaultState.round
            ? (closeParams.overridenStrikePrice, selection.delta())
            : selection.getStrikePrice(expiry, vaultParams.isPut);

        require(strikePrice != 0, "!strikePrice");

        otokenAddress = GammaProtocol.getOrDeployOtoken(
            closeParams.OTOKEN_FACTORY,
            vaultParams.underlying,
            closeParams.USDC,
            vaultParams.asset,
            strikePrice,
            expiry,
            vaultParams.isPut
        );

        verifyOtoken(
            otokenAddress,
            vaultParams,
            closeParams.USDC,
            closeParams.delay
        );

        premium = GnosisAuction.getOTokenPremium(
            otokenAddress,
            vaultParams.optionsPremiumPricer,
            vaultState.premiumDiscount
        );

        require(premium > 0, "!premium");
    }

    function verifyOtoken(
        address otokenAddress,
        Vault.VaultParams calldata vaultParams,
        address USDC,
        uint256 delay
    ) private view {
        require(otokenAddress != address(0), "!otokenAddress");

        IOtoken otoken = IOtoken(otokenAddress);
        require(otoken.isPut() == vaultParams.isPut, "Type mismatch");
        require(
            otoken.underlyingAsset() == vaultParams.underlying,
            "Wrong underlyingAsset"
        );
        require(
            otoken.collateralAsset() == vaultParams.asset,
            "Wrong collateralAsset"
        );

        // we just assume all options use USDC as the strike
        require(otoken.strikeAsset() == USDC, "strikeAsset != USDC");

        uint256 readyAt = block.timestamp.add(delay);
        require(otoken.expiryTimestamp() >= readyAt, "Expiry before delay");
    }
}
