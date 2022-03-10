// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {ISAVAX} from "../interfaces/ISAVAX.sol";
import {IRibbonVault} from "../interfaces/IRibbon.sol";

contract SAVAXDepositHelper {
    ISAVAX public immutable sAVAX;
    IRibbonVault public immutable sAVAXVault;

    constructor(address _sAVAX, address _sAVAXVault) {
        require(_sAVAX != address(0), "!sAVAX");
        require(_sAVAXVault != address(0), "!sAVAXVault");

        sAVAX = ISAVAX(_sAVAX);
        sAVAXVault = IRibbonVault(_sAVAXVault);
    }

    function deposit() external payable {
        uint256 sAVAXAmount = sAVAX.submit{value: msg.value}();
        sAVAX.approve(address(sAVAXVault), sAVAXAmount);
        sAVAXVault.depositFor(sAVAXAmount, msg.sender);
    }

    function depositFor(address recipient) external payable {
        uint256 sAVAXAmount = sAVAX.submit{value: msg.value}();
        sAVAX.approve(address(sAVAXVault), sAVAXAmount);
        sAVAXVault.depositFor(sAVAXAmount, recipient);
    }
}
