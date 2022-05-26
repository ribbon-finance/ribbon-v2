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
import {IWETH} from "../../interfaces/IWETH.sol";
import {RibbonVault} from "../BaseVaults/base/RibbonVault.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";
import {
    RibbonVaultPauserStorage
} from "../../storage/RibbonVaultPauserStorage.sol";

contract RibbonVaultPauser is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    IVaultPauser,
    RibbonVaultPauserStorage
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

    mapping(address => mapping(address => PauseReceipt[]))
        public pausedPositions;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/
    /// @notice WETH9 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable WETH;
    address public immutable STETH;

    /************************************************
     *  EVENTS
     ***********************************************/

    event Pause(
        address indexed account,
        address indexed vaultAddress,
        uint256 share,
        uint256 round
    );

    event Resume(
        address indexed account,
        address indexed vaultAddress,
        uint256 withdrawAmount
    );

    event ProcessWithdrawal(address indexed vaultAddress, uint256 round);

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     */
    constructor(address _weth, address _steth) {
        require(_weth != address(0), "!_weth");

        WETH = _weth;
        STETH = _steth;
    }

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
     *  GETTERS
     ***********************************************/

    /**
     * @notice gets pause position for specific vault and user
     */
    function getPausePositions(address _vaultAddress, address _userAddress)
        external
        view
        returns (PauseReceipt[] memory)
    {
        return pausedPositions[_vaultAddress][_userAddress];
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
     * @notice pause position from vault by redeem all the shares from vault to Pauser
     * @param _account user's address
     * @param _amount the amount of shares
     */
    function pausePosition(address _account, uint256 _amount)
        external
        override
    {
        address currentVaultAddress = address(msg.sender);
        IRibbonThetaVault currentVault = IRibbonThetaVault(currentVaultAddress);

        PauseReceipt[] storage pauseReceipts =
            pausedPositions[currentVaultAddress][_account];

        // user can pause multiple position hence it's necessary to make an array
        // to store each paused position
        pauseReceipts.push(
            PauseReceipt({
                round: uint16(currentVault.vaultState().round),
                account: address(_account),
                shares: uint104(_amount)
            })
        );

        emit Pause(
            _account,
            currentVaultAddress,
            _amount,
            currentVault.vaultState().round
        );

        currentVault.initiateWithdraw(_amount);
    }

    /**
     * @notice resume user's position into vault by making a deposit
     * @param _vaultAddress vault's address
     */
    function resumePosition(address _vaultAddress) external override {
        IRibbonThetaVault currentVault = IRibbonThetaVault(_vaultAddress);

        address currentUser = address(msg.sender);

        PauseReceipt[] memory pauseReceipts =
            pausedPositions[_vaultAddress][currentUser];

        // loop all receipts, convert into withdraw amount and sum it up
        uint256 totalWithdrawAmount = 0;
        uint256 receiptsLength = pauseReceipts.length;
        for (uint16 i = 0; i < receiptsLength; i++) {
            if (pauseReceipts[i].round < currentVault.vaultState().round) {
                totalWithdrawAmount += ShareMath.sharesToAsset(
                    pauseReceipts[i].shares,
                    currentVault.roundPricePerShare(
                        uint256(pauseReceipts[i].round)
                    ),
                    currentVault.vaultParams().decimals
                );
            }
        }

        // delete receipts once finish calculating total withdraw amount
        delete pausedPositions[_vaultAddress][currentUser];

        string memory currentSymbol = currentVault.symbol();

        // stETH transfers suffer from an off-by-1 error
        // since we received STETH , we shall deposit using STETH instead of ETH
        if (
            (keccak256(abi.encodePacked(currentSymbol)) ==
                keccak256(abi.encodePacked("rSTETH-THETA")))
        ) {
            totalWithdrawAmount = totalWithdrawAmount.sub((3 * receiptsLength));

            emit Resume(currentUser, _vaultAddress, totalWithdrawAmount.sub(1));
            IERC20(STETH).approve(_vaultAddress, totalWithdrawAmount);
            currentVault.depositYieldToken(totalWithdrawAmount, currentUser);
            return;
        }

        emit Resume(currentUser, _vaultAddress, totalWithdrawAmount);
        // if asset is ETH, we will convert it into WETH before depositing
        if (currentVault.vaultParams().asset == WETH) {
            IWETH(WETH).deposit{value: totalWithdrawAmount}();
        }
        IERC20(currentVault.vaultParams().asset).approve(
            _vaultAddress,
            totalWithdrawAmount
        );

        currentVault.depositFor(totalWithdrawAmount, currentUser);
    }

    /**
     * @notice process withdrawals by completing in a batch
     * @param _vaultAddress vault's address to be processed
     */
    function processWithdrawal(address _vaultAddress) external onlyKeeper {
        _processWithdrawal(_vaultAddress);
    }

    function _processWithdrawal(address _vaultAddress) private {
        IRibbonThetaVault currentVault = IRibbonThetaVault(_vaultAddress);
        // we can only process withdrawal after closing the previous round
        // hence round should be - 1
        emit ProcessWithdrawal(
            _vaultAddress,
            currentVault.vaultState().round - 1
        );
        currentVault.completeWithdraw();
    }
}
