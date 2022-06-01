// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IVaultPauser {
    /// @notice pause vault position of an account with max amount
    /// @param _account the address of user
    /// @param _amount amount of shares
    function pausePosition(address _account, uint256 _amount) external;

    /// @notice resume vault position of an account with max amount
    /// @param _vaultAddress the address of vault
    function resumePosition(address _vaultAddress) external;

    /// @notice check if there is exist paused position
    /// @param _vaultAddress the address of vault
    /// @param _userAddress the address of user

    function isPaused(address _vaultAddress, address _userAddress)
        external
        view
        returns (bool paused);
}
