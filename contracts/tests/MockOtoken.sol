// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockOtoken is ERC20 {
    address public underlyingAsset;
    bool public isPut;

    constructor(address _underlyingAsset, bool _isPut)
        ERC20("Otoken", "Otoken")
    {
        underlyingAsset = _underlyingAsset;
        isPut = _isPut;
    }

    function mint(uint256 amount) public {
        ERC20._mint(msg.sender, amount);
    }
}
