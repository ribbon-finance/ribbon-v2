// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockLiquidityGauge {
    using SafeERC20 for IERC20;

    address public lp_token;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    constructor(address _lp_token) {
        lp_token = _lp_token;
    }

    function deposit(
        uint256 _value,
        address _addr,
        bool
    ) external {
        if (_value != 0) {
            totalSupply += _value;
            balanceOf[_addr] += _value;

            IERC20(lp_token).safeTransferFrom(
                msg.sender,
                address(this),
                _value
            );
        }
    }
}
