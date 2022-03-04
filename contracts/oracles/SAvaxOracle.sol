// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {ISAVAX} from "../interfaces/ISAVAX.sol";
import {DSMath} from "../vendor/DSMath.sol";

contract SAvaxOracle is IPriceOracle {
    using SafeMath for uint256;

    AggregatorV3Interface public immutable WAVAXOracle;
    ISAVAX public immutable sAVAX;

    constructor(address _sAVAX, address _WAVAXOracle) {
        require(_sAVAX != address(0), "!sAVAX");
        require(_WAVAXOracle != address(0), "!WAVAXOracle");

        sAVAX = ISAVAX(_sAVAX);
        WAVAXOracle = AggregatorV3Interface(_WAVAXOracle);
    }

    function _underlyingPriceToSAvaxPrice(uint256 underlyingPrice)
        private
        view
        returns (uint256)
    {
        // Passing 1e18 to getPooledAvaxByShares() gives us the number of AVAX per sAVAX.
        uint256 sAvaxPerAvax = sAVAX.getPooledAvaxByShares(1e18);
        return sAvaxPerAvax.mul(underlyingPrice).div(1e18);
    }

    function latestAnswer() external view override returns (uint256) {
        (
            uint80 roundID,
            int256 price,
            ,
            uint256 timeStamp,
            uint80 answeredInRound
        ) = WAVAXOracle.latestRoundData();

        require(answeredInRound >= roundID, "Stale oracle price");
        require(timeStamp != 0, "!timeStamp");
        uint256 underlyingPrice = uint256(DSMath.imax(price, 0));
        return _underlyingPriceToSAvaxPrice(underlyingPrice);
    }

    function decimals() external view override returns (uint256) {
        return WAVAXOracle.decimals();
    }
}
