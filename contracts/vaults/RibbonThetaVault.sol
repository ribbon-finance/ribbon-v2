// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {GammaProtocol} from "../protocols/GammaProtocol.sol";

contract RibbonThetaVault is GammaProtocol {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public immutable asset;
    address public immutable underlying;
    address public immutable WETH;
    address public immutable USDC;
    bool public immutable isPut;
    uint8 private immutable _decimals;

    // 90% locked in options protocol, 10% of the pool reserved for withdrawals
    uint256 public constant lockedRatio = 0.9 ether;

    uint256 public constant delay = 1 hours;

    uint256 public immutable MINIMUM_SUPPLY;

    event ManagerChanged(address oldManager, address newManager);

    event Deposit(address indexed account, uint256 amount, uint256 share);

    event Withdraw(
        address indexed account,
        uint256 amount,
        uint256 share,
        uint256 fee
    );

    event OpenShort(
        address indexed options,
        uint256 depositAmount,
        address manager
    );

    event CloseShort(
        address indexed options,
        uint256 withdrawAmount,
        address manager
    );

    event WithdrawalFeeSet(uint256 oldFee, uint256 newFee);

    event CapSet(uint256 oldCap, uint256 newCap, address manager);

    event ScheduleWithdraw(address account, uint256 shares);

    event ScheduledWithdrawCompleted(address account, uint256 amount);

    constructor(
        address _asset,
        address _weth,
        address _usdc,
        uint8 _tokenDecimals,
        uint256 _minimumSupply,
        bool _isPut,
        address _oTokenFactory,
        address _gammaController,
        address _marginPool
    ) GammaProtocol(_oTokenFactory, _gammaController, _marginPool) {
        require(_asset != address(0), "!_asset");
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");
        require(_tokenDecimals > 0, "!_tokenDecimals");
        require(_minimumSupply > 0, "!_minimumSupply");

        asset = _isPut ? _usdc : _asset;
        underlying = _asset;
        WETH = _weth;
        USDC = _usdc;
        _decimals = _tokenDecimals;
        MINIMUM_SUPPLY = _minimumSupply;
        isPut = _isPut;
    }
}
