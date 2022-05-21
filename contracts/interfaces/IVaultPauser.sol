// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IVaultPauser {
    /// @notice Returns the pool address for a given pair of tokens and a fee, or address 0 if it does not exist
    /// @param _account The contract address of either token0 or token1
    /// @param _amount The contract address of the other token
    function pausePosition(address _account, uint256 _amount) external;

    function resumePosition(address _account, uint256 _amount) external;

    function processWithdrawal() external;
}
