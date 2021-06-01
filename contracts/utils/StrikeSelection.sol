// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {DSMath} from "../lib/DSMath.sol";

contract StrikeSelection is DSMath {
    using SafeMath for uint256;

    constructor() {}

    function getStrikePrice(address otoken) external view returns (uint256) {
        return 0;
    }
}
