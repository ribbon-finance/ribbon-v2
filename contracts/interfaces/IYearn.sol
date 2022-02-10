// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IYearnVault {
    function pricePerShare() external view returns (uint256);

    function deposit(uint256 _amount, address _recipient)
        external
        returns (uint256);

    function withdraw(
        uint256 _maxShares,
        address _recipient,
        uint256 _maxLoss
    ) external returns (uint256);

    function approve(address _recipient, uint256 _amount)
        external
        returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function transfer(address recipient, uint256 amount)
        external
        returns (bool);

    function allowance(address owner, address spender)
        external
        view
        returns (uint256);

    function decimals() external view returns (uint256);
}

interface IYearnRegistry {
    function latestVault(address token) external returns (address);
}

interface IYearnPricer {
    function setExpiryPriceInOracle(uint256 _expiryTimestamp) external;

    function getPrice() external view returns (uint256);
}
