// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

library Vault {
    struct VaultParams {
        // Option type the vault is selling
        bool isPut;
        // Token decimals for vault shares
        uint8 decimals;
        // Asset used in Theta / Delta Vault
        address asset;
        // Underlying asset of the options sold by vault
        address underlying;
        // Minimum supply of the vault shares issued, for ETH it's 10**10
        uint56 minimumSupply;
        // Vault cap
        uint104 cap;
    }
}

interface IRibbonThetaVault {
    function currentOption() external view returns (address _currentOption);

    function nextOption() external view returns (address _nextOption);

    function vaultParams() external view returns (Vault.VaultParams memory);

    function optionAuctionID() external view returns (uint256 _auctionID);
}
