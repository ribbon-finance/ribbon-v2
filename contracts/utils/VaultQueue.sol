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
import {ISAVAX} from "../interfaces/ISAVAX.sol";
import {IRibbonVault, IDepositContract} from "../interfaces/IRibbon.sol";
import {ICRV} from "../interfaces/ICRV.sol";
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
        address srcVault;
        address dstVault;
        address depositContract;
        uint32 timestamp;
        uint256 amount;
        TransferAction action;
    }

    using SafeERC20 for IERC20;

    mapping(address => Transfer[]) public qTransfer;
    mapping(address => uint256) public totalAmount;

    address public wethVault;
    address public stethVault;

    event Disburse(address vault, Transfer txn, uint256 portion);

    function initialize(address _wethVault, address _stethVault)
        external
        initializer
    {
        __ReentrancyGuard_init();
        __Ownable_init();

        transferOwnership(msg.sender);

        wethVault = _wethVault; // Can be the native vault (weth or wavax)
        stethVault = _stethVault; // Must ONLY be steth vault.  (savax vault returns erc20, set as keeper)
    }

    function getInterVaultBalance(address vault)
        private
        view
        returns (uint256 balance)
    {
        // Case 1. stETH - Withdrawing gives stETH
        // Case 2. WETH - Withdrawing gives ETH
        // Case 3. erc20 token
        if (vault == stethVault) {
            address steth = IRibbonVault(vault).STETH();
            balance = IERC20(steth).balanceOf(address(this));
        } else if (vault == wethVault) {
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
        if (vault == stethVault) {
            address steth = IRibbonVault(vault).STETH();
            IERC20(steth).transfer(creditor, portion);
        } else if (vault == wethVault) {
            payable(creditor).transfer(portion);
        } else {
            Vault.VaultParams memory vaultParams =
                IRibbonVault(vault).vaultParams();
            IERC20(vaultParams.asset).transfer(creditor, portion);
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

    function transfer(address vault) external onlyOwner nonReentrant {
        uint256 withdrawals = IRibbonVault(vault).withdrawals(address(this));
        if (withdrawals > 0) {
            if (vault == stethVault) {
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
        address dstVault,
        address depositContract,
        TransferAction transferAction,
        uint256 amount
    ) external nonReentrant {
        require(
            !hasWithdrawal(srcVault, msg.sender),
            "Withdraw already submitted"
        );
        require(qTransfer[srcVault].length < 256, "Transfer queue full");

        if (transferAction == TransferAction.INTERVAULT) {
            require(depositContract != address(0), "Intervault !address");
        } else if (transferAction == TransferAction.WITHDRAW) {
            // depositContract is not used on withdraw, so let's set it to msg.sender
            require(
                depositContract == msg.sender,
                "On withdraw, depositContract must be msg.sender"
            );
        }

        IRibbonVault(srcVault).transferFrom(msg.sender, address(this), amount);

        IRibbonVault(srcVault).initiateWithdraw(amount);

        qTransfer[srcVault].push(
            Transfer(
                msg.sender,
                srcVault,
                dstVault,
                depositContract,
                uint32(block.timestamp),
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
        for (uint256 j = 0; j < qTransfer[vault].length; j++) {
            if (user == qTransfer[vault][j].creditor) {
                return true;
            }
        }
        return false;
    }

    function pop(Transfer[] storage array) private returns (Transfer memory) {
        Transfer memory item = array[array.length - 1];
        array.pop();
        return item;
    }

    function reset(address vault) external onlyOwner {
        delete qTransfer[vault];
        totalAmount[vault] = 0;
    }

    // ETH and ERC20s are not kept in this contract unless explicitly sent.
    // This contract intermediately holds tokens only during transfer() and only within the transaction.
    function rescueETH(uint256 amount) external onlyOwner {
        payable(msg.sender).transfer(amount);
    }

    function rescue(address asset, uint256 amount) external onlyOwner {
        IERC20(asset).approve(address(this), amount);
        IERC20(asset).transfer(msg.sender, amount);
    }

    receive() external payable {}
}
