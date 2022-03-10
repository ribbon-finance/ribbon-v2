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
import {ISAVAX} from "../interfaces/ISAVAX.sol";
import {IRibbonVault, IDepositContract} from "../interfaces/IRibbon.sol";
import {Vault} from "../libraries/Vault.sol";
import {DSMath} from "../vendor/DSMath.sol";

interface IVaultQueue {
    enum TransferType {INTERVAULT, SKIP_ROUND}
    struct Transfer {
        address creditor;
        address srcVault;
        address dstVault;
        address depositContract;
        uint256 amount;
        uint256 timestamp;
    }
}

contract VaultQueue is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    mapping(address => IVaultQueue.Transfer[]) public qTransfer;
    mapping(address => uint256) public totalAmount;
    address[] public vaults;

    function initialize() external initializer {
        __ReentrancyGuard_init();
        __Ownable_init();
        transferOwnership(msg.sender);
    }

    function transfer() external onlyOwner nonReentrant {
        for (uint256 i = 0; i < vaults.length; i++) {
            IRibbonVault(vaults[i]).completeWithdraw();
        }

        for (uint256 i = 0; i < vaults.length; i++) {
            uint256 balance = address(this).balance;
            address vault = vaults[i];
            uint256 len = qTransfer[vault].length;
            uint256 totalAmt = totalAmount[vault];
            totalAmount[vault] = 0;

            for (uint256 j = len; j > 0; j--) {
                IVaultQueue.Transfer memory queue = pop(qTransfer[vault]);

                uint256 portion =
                    DSMath.wmul(balance, DSMath.wdiv(queue.amount, totalAmt));
                require(portion > 0, "!portion");

                IDepositContract(queue.depositContract).depositFor{
                    value: portion
                }(queue.creditor);
            }
        }
    }

    function queueTransfer(
        address srcVault,
        address dstVault,
        address depositContract,
        uint256 amount
    ) external nonReentrant {
        require(!hasWithdrawal(msg.sender), "Withdraw already submitted");
        require(qTransfer[srcVault].length < 256, "Transfer queue full");

        IRibbonVault(srcVault).transferFrom(msg.sender, address(this), amount);

        IRibbonVault(srcVault).initiateWithdraw(amount);

        qTransfer[srcVault].push(
            IVaultQueue.Transfer(
                msg.sender,
                srcVault,
                dstVault,
                depositContract,
                amount,
                uint256(block.timestamp)
            )
        );
        totalAmount[srcVault] += amount;
    }

    function hasWithdrawal(address user) public view returns (bool) {
        for (uint256 i = 0; i < vaults.length; i++) {
            address vault = vaults[i];
            for (uint256 j = 0; j < qTransfer[vault].length; j++) {
                if (user == qTransfer[vault][j].creditor) {
                    return true;
                }
            }
        }
        return false;
    }

    function pushVault(address vault) external onlyOwner {
        vaults.push(vault);
    }

    function pop(IVaultQueue.Transfer[] storage array)
        internal
        returns (IVaultQueue.Transfer memory)
    {
        IVaultQueue.Transfer memory item = array[array.length - 1];
        array.pop();
        return item;
    }

    function setQTransfer(
        address vault,
        uint256 index,
        address user,
        address srcVault,
        address dstVault,
        address depositContract,
        uint256 amount
    ) external onlyOwner {
        qTransfer[vault][index] = IVaultQueue.Transfer(
            user,
            srcVault,
            dstVault,
            depositContract,
            amount,
            block.timestamp
        );
    }

    function reset() external onlyOwner {
        for (uint256 i = 0; i < vaults.length; i++) {
            delete qTransfer[vaults[i]];
            totalAmount[vaults[i]] = 0;
        }
        delete vaults;
    }

    // ETH and ERC20s are not kept in this contract unless explicitly sent.
    // This contract intermediately holds tokens only during transfer() and only within the transaction.
    function rescueETH(uint256 amount) external onlyOwner {
        payable(msg.sender).transfer(amount);
    }

    function rescue(address asset, uint256 amount) external onlyOwner {
        IERC20(asset).approve(address(this), amount);
        IERC20(asset).transferFrom(address(this), msg.sender, amount);
    }

    receive() external payable {}
}
