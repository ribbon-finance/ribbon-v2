// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {
    Initializable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRibbonVault, IDepositContract} from "../interfaces/IRibbon.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {Vault} from "../libraries/Vault.sol";
import {DSMath} from "../vendor/DSMath.sol";

contract VaultQueue is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    enum TransferAction {INTERVAULT, WITHDRAW}
    struct Transfer {
        address creditor;
        address depositContract;
        uint256 amount;
        TransferAction action;
    }

    using SafeERC20 for IERC20;

    address public immutable WETH_VAULT;
    address public immutable STETH_VAULT;

    mapping(address => Transfer[]) public qTransfer;
    mapping(address => uint256) public totalAmount;
    mapping(address => bool) public isDepositContract;
    uint256 public queueSize;
    address public keeper;

    event Disburse(address vault, Transfer txn, uint256 portion);
    event SetQueueSize(uint256 queueSize);

    constructor(address _wethVault, address _stethVault) {
        require(_wethVault != address(0), "!_wethVault");
        require(_stethVault != address(0), "!_stethVault");

        WETH_VAULT = _wethVault; // Can be the native vault (weth or wavax)
        STETH_VAULT = _stethVault; // Must ONLY be steth vault.  (savax vault returns erc20, set as keeper)
    }

    function initialize() external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();

        queueSize = 32;
    }

    function getInterVaultBalance(address vault)
        private
        view
        returns (uint256 balance)
    {
        // Case 1. stETH - Withdrawing gives stETH
        // Case 2. WETH - Withdrawing gives ETH
        // Case 3. erc20 token
        if (vault == STETH_VAULT) {
            address steth = IRibbonVault(vault).STETH();
            balance = IERC20(steth).balanceOf(address(this));
        } else if (vault == WETH_VAULT) {
            balance = address(this).balance;
        } else {
            Vault.VaultParams memory vaultParams =
                IRibbonVault(vault).vaultParams();
            balance = IERC20(vaultParams.asset).balanceOf(address(this));
        }
    }

    function withdrawToCreditor(
        address vault,
        address creditor,
        uint256 portion
    ) private {
        if (vault == STETH_VAULT) {
            address steth = IRibbonVault(vault).STETH();
            IERC20(steth).transfer(creditor, portion);
        } else if (vault == WETH_VAULT) {
            address asset = IRibbonVault(vault).vaultParams().asset;

            (bool sent, ) = creditor.call{value: portion}("");

            // If the creditor is intentionally or unintentionally reverting the ETH transfer
            // we send them WETH instead
            if (!sent) {
                IWETH(asset).deposit{value: portion}();
                IWETH(asset).transfer(creditor, portion);
            }
        } else {
            Vault.VaultParams memory vaultParams =
                IRibbonVault(vault).vaultParams();
            IERC20(vaultParams.asset).safeTransfer(creditor, portion);
        }
    }

    function transferToVault(
        address depositContract,
        address creditor,
        uint256 portion
    ) private {
        IDepositContract(depositContract).depositFor{value: portion}(creditor);
    }

    function disburse(address vault) private {
        uint256 balance = getInterVaultBalance(vault);
        uint256 len = qTransfer[vault].length;
        uint256 totalAmt = totalAmount[vault];
        totalAmount[vault] = 0;

        for (uint256 j = len; j > 0; j--) {
            Transfer memory queue = pop(qTransfer[vault]);

            uint256 portion =
                DSMath.wmul(balance, DSMath.wdiv(queue.amount, totalAmt));
            if (portion > 0) {
                if (queue.action == TransferAction.INTERVAULT) {
                    transferToVault(
                        queue.depositContract,
                        queue.creditor,
                        portion
                    );
                } else if (queue.action == TransferAction.WITHDRAW) {
                    withdrawToCreditor(vault, queue.creditor, portion);
                }
                emit Disburse(vault, queue, portion);
            }
        }
    }

    function transfer(address vault) external onlyKeeper nonReentrant {
        uint256 withdrawals =
            IRibbonVault(vault).withdrawals(address(this)).shares;
        if (withdrawals > 0) {
            if (vault == STETH_VAULT) {
                IRibbonVault(vault).completeWithdraw(0);
                disburse(vault);
            } else {
                IRibbonVault(vault).completeWithdraw();
                disburse(vault);
            }
        }
    }

    function queueTransfer(
        address srcVault,
        address depositContract,
        TransferAction transferAction,
        uint256 amount
    ) external nonReentrant {
        require(qTransfer[srcVault].length < queueSize, "Transfer queue full");

        if (transferAction == TransferAction.INTERVAULT) {
            require(
                isDepositContract[depositContract],
                "Not a deposit contract"
            );
        } else if (transferAction == TransferAction.WITHDRAW) {
            // depositContract is not used on withdraw, so let's set it to address(0)
            require(
                depositContract == address(0),
                "On withdraw, depositContract must be 0x0"
            );
        }

        IRibbonVault(srcVault).transferFrom(msg.sender, address(this), amount);

        IRibbonVault(srcVault).initiateWithdraw(amount);

        qTransfer[srcVault].push(
            Transfer(
                msg.sender,
                depositContract,
                amount,
                transferAction
            )
        );
        totalAmount[srcVault] += amount;
    }

    function hasWithdrawal(address vault, address user)
        public
        view
        returns (bool)
    {
        for (uint256 j = 0; j < qTransfer[vault].length; ++j) {
            if (user == qTransfer[vault][j].creditor) {
                return true;
            }
        }
        return false;
    }

    function setQueueSize(uint256 _queueSize) external onlyOwner {
        queueSize = _queueSize;
        emit SetQueueSize(_queueSize);
    }

    function setDepositContract(
        address depositContract,
        bool setIsDepositContract
    ) external onlyOwner {
        isDepositContract[depositContract] = setIsDepositContract;
    }

    function pop(Transfer[] storage array) private returns (Transfer memory) {
        Transfer memory item = array[array.length - 1];
        array.pop();
        return item;
    }

    function setKeeper(address newKeeper) external onlyOwner {
        keeper = newKeeper;
    }

    modifier onlyVault {
        require(
            msg.sender == WETH_VAULT || msg.sender == STETH_VAULT,
            "Invalid sender"
        );
        _;
    }

    modifier onlyKeeper {
        require(msg.sender == keeper, "Only keeper");
        _;
    }

    receive() external payable onlyVault {}
}
