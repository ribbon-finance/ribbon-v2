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
import {IVaultPaucer} from "../../interfaces/IVaultPauser";
import {Vault} from "../../../libraries/Vault.sol";

contract RibbonVaultPauser is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    RibbonVaultPauserStorage,
    IVaultPauser
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /************************************************
     *  NON UPGRADEABLE STORAGE
     ***********************************************/

    /// @notice Stores all the vault's paused positions
    mapping(address => mapping(address => uint256)) public pausedPositions;

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

    /**
     * @notice Initializes the contract with storage variables.
     */
    function initialize() external initializer {
        _initialize(_owner, _keeper);
        __ReentrancyGuard_init();

        keeper = _initParams._keeper;
    }

    function _initialize(address _owner, address _keeper) internal {}

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

    /**
     * @notice pause position for certain vault
     * @dev assume that user has already redeemed the shares (basically it should work behind the scene)
     * then you can transfer the shares into VaultPauser
     * @param newKeeper is the address of the new keeper
     */
    function pausePosition(
        address _account,
        uint256 _amount,
        address _vaultAddress
    ) external override {
        // IERC transfer to Pauser
        // pausedPosition[vaultAddress][msg.sender] = _amount
        // initiate withdrawal
    }

    function resumePosition(address _account, uint256 _amount)
        external
        override
    {
        // depositFor
    }

    function processWithdrawal() external onlyKeeper {}

    function _processWithdrawal() private {}
}
