// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IVaultDeploymentEventEmitter {

    /// @notice Enum describing the types of vault
    enum VaultType {
        normal,
        earn,
        vip,
        treasury
    }

    /**
     * @notice Emits an event with the vault address and type
     * @param _newVaultAddress the address of the vault
     * @param _vaultType the type of the vault
     */
    function newVault(address _newVaultAddress, VaultType _vaultType) external;
}
