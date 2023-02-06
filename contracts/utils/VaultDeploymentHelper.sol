// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";

contract VaultDeploymentHelper is Ownable {
    /**
     * @notice Emitted when a new vault is deployed
     * @param vaultAddress the address of the new vault
     */
    event NewVault(address vaultAddress);

    /**
     * @notice Emits an event with the new vault address
     * @param _newVaultAddress the address of the new vault
     */
    function newVault(address _newVaultAddress) external onlyOwner {
        require(_newVaultAddress != address(0), "!_newVaultAddress");
        emit NewVault(_newVaultAddress);
    }
}
