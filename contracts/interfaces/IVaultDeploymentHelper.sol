// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IVaultDeploymentHelper {
    /**
     * @notice Emits an event with the new vault address
     * @param _newVaultAddress the address of the new vault
     */
    function newVault(address _newVaultAddress) external;
}
