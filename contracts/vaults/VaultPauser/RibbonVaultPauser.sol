// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IVaultPauser} from "../../interfaces/IVaultPauser.sol";
import {Vault} from "../../libraries/Vault.sol";
import {IRibbonThetaVault} from "../../interfaces/IRibbonThetaVault.sol";
import {RibbonVault} from "../BaseVaults/base/RibbonVault.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";
import "hardhat/console.sol";

contract RibbonVaultPauser is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    IVaultPauser
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /************************************************
     *  NON UPGRADEABLE STORAGE
     ***********************************************/

    /// @notice Stores all the vault's paused positions
    struct PauseReceipt {
        uint16 round;
        address account;
        uint128 shares;
    }

    mapping(address => mapping(address => PauseReceipt)) public pausedPositions;

    /// @notice role in charge of weekly vault operations
    // no access to critical vault changes
    address public keeper;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /************************************************
     *  EVENTS
     ***********************************************/

    event Pause();

    event Resume();

    event ProcessWithdrawal();

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     */
    constructor() {}

    // /**
    //  * @notice Initializes the contract with storage variables.
    //  */
    function initialize(address _owner, address _keeper) external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        transferOwnership(_owner);
        keeper = _keeper;
    }

    /**
     * @dev Throws if called by any account other than the keeper.
     */
    modifier onlyKeeper() {
        require(msg.sender == keeper, "!keeper");
        _;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new keeper
     * @param newKeeper is the address of the new keeper
     */
    function setNewKeeper(address newKeeper) external onlyOwner {
        require(newKeeper != address(0), "!newKeeper");
        keeper = newKeeper;
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    function pausePosition(address _account, uint256 _amount)
        external
        override
    {
        address currentVaultAddress = address(msg.sender);
        IRibbonThetaVault currentVault = IRibbonThetaVault(currentVaultAddress);

        currentVault.initiateWithdraw(_amount);

        pausedPositions[currentVaultAddress][_account] = PauseReceipt({
            round: uint16(currentVault.vaultState().round),
            account: address(_account),
            shares: uint104(_amount)
        });
    }

    function resumePosition(address _vaultAddress) external override {
        IRibbonThetaVault currentVault = IRibbonThetaVault(_vaultAddress);

        address currentUser = address(msg.sender);

        PauseReceipt memory pauseReceipt =
            pausedPositions[_vaultAddress][currentUser];

        uint256 withdrawAmount =
            ShareMath.sharesToAsset(
                pauseReceipt.shares,
                currentVault.roundPricePerShare(uint256(pauseReceipt.round)),
                currentVault.vaultParams().decimals
            );

        // doesn't work for ETH yet
        IERC20(currentVault.vaultParams().asset).approve(
            _vaultAddress,
            withdrawAmount
        );

        currentVault.depositFor(withdrawAmount, currentUser);
    }

    function processWithdrawal(address _vaultAddress) external onlyKeeper {
        _processWithdrawal(_vaultAddress);
    }

    function _processWithdrawal(address _vaultAddress) private {
        IRibbonThetaVault currentVault = IRibbonThetaVault(_vaultAddress);
        currentVault.completeWithdraw();
    }
}
