// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;
import {Vault} from "../libraries/Vault.sol";

interface IRibbonVault {
    function deposit(uint256 amount) external;

    function depositETH() external payable;

    function cap() external view returns (uint256);

    function WETH() external view returns (address);

    function withdrawals(address) external view returns (uint256);

    function depositFor(uint256 amount, address creditor) external;

    function depositFor(address creditor) external payable;

    function vaultParams() external view returns (Vault.VaultParams memory);

    function completeWithdraw() external;

    function initiateWithdraw(uint256 numShares) external;

    function redeem(uint256 numShares) external;

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    // STETH
    function STETH() external view returns (address);

    function collateralToken() external view returns (address);

    function completeWithdraw(uint256 minAmountOut) external;
}

interface IStrikeSelection {
    function getStrikePrice(uint256 expiryTimestamp, bool isPut)
        external
        view
        returns (uint256, uint256);

    function delta() external view returns (uint256);
}

interface IOptionsPremiumPricer {
    function getPremium(
        uint256 strikePrice,
        uint256 timeToExpiry,
        bool isPut
    ) external view returns (uint256);

    function getPremiumInStables(
        uint256 strikePrice,
        uint256 timeToExpiry,
        bool isPut
    ) external view returns (uint256);

    function getOptionDelta(
        uint256 spotPrice,
        uint256 strikePrice,
        uint256 volatility,
        uint256 expiryTimestamp
    ) external view returns (uint256 delta);

    function getUnderlyingPrice() external view returns (uint256);

    function priceOracle() external view returns (address);

    function volatilityOracle() external view returns (address);

    function optionId() external view returns (bytes32);
}

interface IDepositContract {
    function depositFor(address recipient) external payable;
}
