// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IVaultPauser} from "../../interfaces/IVaultPauser.sol";
import {Vault} from "../../libraries/Vault.sol";
import {IRibbonThetaVault} from "../../interfaces/IRibbonThetaVault.sol";
import {IWETH} from "../../interfaces/IWETH.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";

contract RibbonVaultPauser is Ownable, IVaultPauser {
    using SafeERC20 for IERC20;

    /************************************************
     *  NON UPGRADEABLE STORAGE
     ***********************************************/

    /// @notice Stores all the vault's paused positions
    struct PauseReceipt {
        uint16 round;
        uint128 shares;
    }

    mapping(address => mapping(address => PauseReceipt)) public pausedPositions;
    mapping(address => bool) private registeredVaults;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/
    /// @notice WETH9 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable WETH;
    address public immutable STETH;
    address public immutable STETH_VAULT;

    address public keeper;
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
    constructor(
        address _keeper,
        address _weth,
        address _steth,
        address _steth_vault
    ) {
        require(_keeper != address(0), "!_keeper");
        require(_weth != address(0), "!_weth");
        require(_steth != address(0), "!_steth");
        require(_steth_vault != address(0), "!_steth_vault");

        keeper = _keeper;
        WETH = _weth;
        STETH = _steth;
        STETH_VAULT = _steth_vault;
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

    function getPausePosition(address _vaultAddress, address _userAddress)
        external
        view
        returns (PauseReceipt memory)
    {
        return pausedPositions[_vaultAddress][_userAddress];
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new keeper
     * @param _newKeeper is the address of the new keeper
     */
    function setNewKeeper(address _newKeeper) external onlyOwner {
        require(_newKeeper != address(0), "!newKeeper");
        keeper = _newKeeper;
    }

    /**
     * @notice add vault into registered vaults
     * @param _vaultAddress is the address of the new vault to be registered
     */
    function addVault(address _vaultAddress) external onlyOwner {
        registeredVaults[_vaultAddress] = true;
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
        address currentVaultAddress = msg.sender;
        IRibbonThetaVault currentVault = IRibbonThetaVault(currentVaultAddress);

        // check if vault is registered
        require(
            registeredVaults[currentVaultAddress],
            "Vault is not registered"
        );

        PauseReceipt storage pausedPosition =
            pausedPositions[currentVaultAddress][_account];

        // check if position is paused
        require(
            pausedPosition.shares == 0 && pausedPosition.round == 0,
            "Position is paused"
        );

        uint16 round = currentVault.vaultState().round;

        require(_amount < type(uint128).max, "_amount overflow");

        pausedPositions[currentVaultAddress][_account] = PauseReceipt({
            round: round,
            shares: uint128(_amount)
        });

        emit Pause(_account, currentVaultAddress, _amount, round);

        // transfer from user to pauser
        IERC20(currentVaultAddress).safeTransferFrom(
            _account,
            address(this),
            _amount
        );

        currentVault.initiateWithdraw(_amount);
    }

    /**
     * @notice resume user's position into vault by making a deposit
     * @param _vaultAddress vault's address
     */
    function resumePosition(address _vaultAddress) external override {
        IRibbonThetaVault currentVault = IRibbonThetaVault(_vaultAddress);

        // check if vault is registered
        require(registeredVaults[_vaultAddress], "Vault is not registered");

        // get params and round
        Vault.VaultParams memory currentParams = currentVault.vaultParams();
        uint256 round = currentVault.vaultState().round;

        PauseReceipt storage pauseReceipt =
            pausedPositions[_vaultAddress][msg.sender];
        uint256 pauseReceiptRound = pauseReceipt.round;

        // check if roun is closed before resuming position
        require(pauseReceiptRound < round, "Round not closed yet");
        uint256 totalWithdrawAmount =
            ShareMath.sharesToAsset(
                pauseReceipt.shares,
                currentVault.roundPricePerShare(pauseReceiptRound),
                currentParams.decimals
            );

        // delete position once transfer (revert to zero)
        delete pausedPositions[_vaultAddress][msg.sender];

        // stETH transfers suffer from an off-by-1 error
        // since we received STETH , we shall deposit using STETH instead of ETH
        if (_vaultAddress == STETH_VAULT) {
            totalWithdrawAmount = totalWithdrawAmount - 3;

            emit Resume(msg.sender, _vaultAddress, totalWithdrawAmount - 1);
            IERC20(STETH).safeApprove(_vaultAddress, totalWithdrawAmount);
            currentVault.depositYieldTokenFor(totalWithdrawAmount, msg.sender);
        } else {
            emit Resume(msg.sender, _vaultAddress, totalWithdrawAmount);

            // if asset is ETH, we will convert it into WETH before depositing
            if (currentParams.asset == WETH) {
                IWETH(WETH).deposit{value: totalWithdrawAmount}();
            }
            IERC20(currentParams.asset).safeApprove(
                _vaultAddress,
                totalWithdrawAmount
            );

            currentVault.depositFor(totalWithdrawAmount, msg.sender);
        }
    }

    /**
     * @notice process withdrawals by completing in a batch
     * @param _vaultAddress vault's address to be processed
     */
    function processWithdrawal(address _vaultAddress) external onlyKeeper {
        IRibbonThetaVault currentVault = IRibbonThetaVault(_vaultAddress);
        // we can only process withdrawal after closing the previous round
        // hence round should be - 1
        emit ProcessWithdrawal(
            _vaultAddress,
            currentVault.vaultState().round - 1
        );
        currentVault.completeWithdraw();
    }

    fallback() external payable {}

    receive() external payable {}
}
