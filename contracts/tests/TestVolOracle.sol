//SPDX-License-Identifier: GPL-3.0
pragma solidity 0.7.3;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {
    PRBMathSD59x18
} from "@ribbon-finance/rvol/contracts/libraries/PRBMathSD59x18.sol";
import {Math} from "@ribbon-finance/rvol/contracts/libraries/Math.sol";
import {DSMath} from "@ribbon-finance/rvol/contracts/libraries/DSMath.sol";
import {Welford} from "@ribbon-finance/rvol/contracts/libraries/Welford.sol";
import {VolOracle} from "@ribbon-finance/rvol/contracts/core/VolOracle.sol";

contract TestVolOracle is DSMath, VolOracle {
    using SafeMath for uint256;
    uint256 private _price;

    constructor(uint32 _period) VolOracle(_period) {}

    function mockCommit(address pool) external {
        (uint32 commitTimestamp, uint32 gapFromPeriod) = secondsFromPeriod();
        require(gapFromPeriod < commitPhaseDuration, "Not commit phase");

        uint256 price = mockTwap();
        uint256 _lastPrice = lastPrices[pool];
        uint256 periodReturn = _lastPrice > 0 ? wdiv(price, _lastPrice) : 0;

        // logReturn is in 10**18
        // we need to scale it down to 10**8
        int256 logReturn =
            periodReturn > 0
                ? PRBMathSD59x18.ln(int256(periodReturn)) / 10**10
                : 0;

        Accumulator storage accum = accumulators[pool];

        require(
            block.timestamp >=
                accum.lastTimestamp + period - commitPhaseDuration,
            "Committed"
        );

        (uint256 newCount, uint256 newMean, uint256 newM2) =
            Welford.update(accum.count, accum.mean, accum.m2, logReturn);

        require(newCount < type(uint16).max, ">U16");
        require(newMean < type(uint96).max, ">U96");
        require(newM2 < type(uint112).max, ">U112");

        accum.count = uint16(newCount);
        accum.mean = uint96(newMean);
        accum.m2 = uint112(newM2);
        accum.lastTimestamp = commitTimestamp;
        lastPrices[pool] = price;

        emit Commit(
            uint16(newCount),
            uint32(commitTimestamp),
            uint96(newMean),
            uint112(newM2),
            price,
            msg.sender
        );
    }

    function mockTwap() private view returns (uint256) {
        return _price;
    }

    function setPrice(uint256 price) public {
        _price = price;
    }
}
