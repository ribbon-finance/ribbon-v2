// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VaultDeploymentEventEmitter is Ownable {
    /************************************************
     *  EVENTS
     ***********************************************/

    /**
     * @notice Emitted when a vault is deployed
     * @param vaultAddress the address of the vault
     * @param vaultType the type of the vault
     */
    event NewVault(address vaultAddress, VaultType indexed vaultType);

    /************************************************
     *  STORAGE
     ***********************************************/

    /// @notice Enum describing the types of vault
    enum VaultType {
        normal,
        earn,
        vip,
        treasury
    }

    /// @notice Stores the vault addresses for each vault type
    mapping(VaultType => address[]) vaultAddresses;

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Emits an event with the vault address and type
     * @param _newVaultAddress the address of the vault
     * @param _vaultType the type of the vault
     */
    function newVault(address _newVaultAddress, VaultType _vaultType)
        external
        onlyOwner
    {
        require(_newVaultAddress != address(0), "!_newVaultAddress");

        vaultAddresses[_vaultType].push(_newVaultAddress);

        emit NewVault(_newVaultAddress, _vaultType);
    }

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Gets all vault addresses of the chosen vault type
     * @param _vaultType the type of the vault
     * @return array with the vault addresses of the chosen vault type
     */
    function getVaultAddresses(VaultType _vaultType)
        external
        view
        returns (address[] memory)
    {
        return vaultAddresses[_vaultType];
    }
}
