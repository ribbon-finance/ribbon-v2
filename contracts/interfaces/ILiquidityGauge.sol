// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface ILiquidityGauge {
    function balanceOf(address) external view returns (uint256);

    function deposit(
        uint256 _value,
        address _addr,
        bool _claim_rewards
    ) external;

    function withdraw(uint256 _value) external;
}
