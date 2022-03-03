// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IController} from "../interfaces/PowerTokenInterface.sol";
import {VaultLib} from "./PowerTokenVaultLib.sol";

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
}
