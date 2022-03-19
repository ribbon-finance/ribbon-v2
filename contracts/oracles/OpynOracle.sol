// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import {IOracle} from "../interfaces/GammaInterface.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

contract OpynOracle is IPriceOracle {
    /// @dev base decimals
    uint256 public constant override decimals = 8;

    /// @notice Gamma Protocol oracle
    IOracle public immutable oracle;

    /// @notice Asset to get the price of
    address public immutable asset;

    constructor(address _oracle, address _asset) {
        require(_oracle != address(0), "!oracle");
        require(_asset != address(0), "!asset");

        oracle = IOracle(_oracle);
        asset = _asset;
    }

    function latestAnswer() external view override returns (uint256) {
        return oracle.getPrice(asset);
    }
}
