// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract ManualStrikeSelection is Ownable {
    /// @dev Selected strike price
    uint256 public strikePrice;

    /// @dev Delta for options strike price selection. 1 is 10000 (10**4)
    uint256 public constant delta = 1000;

    /**
     * @notice Sets the strike price, only callable by the owner
     * @param _strikePrice is the strike price of the option
     */
    function setStrikePrice(uint256 _strikePrice) external onlyOwner {
        strikePrice = _strikePrice;
    }

    /**
     * @notice Gets the strike price satisfying the delta value
     * given the expiry timestamp and whether option is call or put
     * @return newStrikePrice is the strike price of the option (ex: for BTC might be 45000 * 10 ** 8)
     * @return newDelta is the delta of the option given its parameters
     */
    function getStrikePrice(uint256, bool)
        external
        view
        returns (uint256, uint256)
    {
        return (strikePrice, delta);
    }
}
