// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {
    IPriceOracle
} from "@ribbon-finance/rvol/contracts/interfaces/IPriceOracle.sol";
import {DSMath} from "../vendor/DSMath.sol";
import {IOptionsPremiumPricer} from "../interfaces/IRibbon.sol";
import {
    IVolatilityOracle
} from "@ribbon-finance/rvol/contracts/interfaces/IVolatilityOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StrikeSelection is DSMath, Ownable {
    using SafeMath for uint256;

    /**
     * Immutables
     */
    IOptionsPremiumPricer public immutable optionsPremiumPricer;
    IVolatilityOracle public immutable volatilityOracle;

    // delta for options strike price selection. 1 is 10000
    uint256 public delta;
    // step in absolute terms at which we will increment
    // (ex: 100 * 10 ** assetOracleDecimals means we will move at increments of 100 points)
    uint256 public step;
    // multiplier to shift asset prices
    uint256 private immutable assetOracleMultiplier;

    event DeltaSet(uint256 oldDelta, uint256 newDelta, address owner);
    event StepSet(uint256 oldStep, uint256 newStep, address owner);

    constructor(
        address _optionsPremiumPricer,
        uint256 _delta,
        uint256 _step
    ) {
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        require(_delta > 0, "!_delta");
        require(_step > 0, "!_step");
        optionsPremiumPricer = IOptionsPremiumPricer(_optionsPremiumPricer);
        volatilityOracle = IVolatilityOracle(
            IOptionsPremiumPricer(_optionsPremiumPricer).volatilityOracle()
        );
        // ex: delta = 7500 (.75)
        delta = _delta;
        uint256 _assetOracleMultiplier =
            10 **
                IPriceOracle(
                    IOptionsPremiumPricer(_optionsPremiumPricer).priceOracle()
                )
                    .decimals();

        // ex: step = 1000
        step = _step.mul(_assetOracleMultiplier);

        assetOracleMultiplier = _assetOracleMultiplier;
    }

    /**
     * @notice Gets the strike price satisfying the delta value
     * given the expiry timestamp and whether option is call or put
     * @param expiryTimestamp is the unix timestamp of expiration
     * @param isPut is whether option is put or call
     */

    function getStrikePrice(uint256 expiryTimestamp, bool isPut)
        external
        view
        returns (uint256, uint256)
    {
        require(
            expiryTimestamp > block.timestamp,
            "Expiry must be in the future!"
        );

        // asset price
        uint256 assetPrice = optionsPremiumPricer.getUnderlyingPrice();

        // asset's annualized volatility
        uint256 annualizedVol =
            volatilityOracle.annualizedVol(optionsPremiumPricer.pool()).mul(
                10**10
            );

        // For each asset prices with step of 'step' (down if put, up if call)
        //   if asset's getOptionDelta(currStrikePrice, spotPrice, annualizedVol, t) == (isPut ? 1 - delta:delta)
        //   with certain margin of error
        //        return strike price

        uint256 strike =
            isPut
                ? assetPrice.sub(assetPrice % step)
                : assetPrice.add(step - (assetPrice % step));
        uint256 targetDelta = isPut ? uint256(10000).sub(delta) : delta;
        uint256 prevDelta = 10000;

        while (true) {
            uint256 currDelta =
                optionsPremiumPricer.getOptionDelta(
                    assetPrice.mul(10**8).div(assetOracleMultiplier),
                    strike,
                    annualizedVol,
                    expiryTimestamp
                );
            //  If the current delta is between the previous
            //  strike price delta and current strike price delta
            //  then we are done
            bool foundTargetStrikePrice =
                isPut
                    ? targetDelta >= prevDelta && targetDelta <= currDelta
                    : targetDelta <= prevDelta && targetDelta >= currDelta;

            if (foundTargetStrikePrice) {
                uint256 finalDelta =
                    _getBestDelta(prevDelta, currDelta, targetDelta, isPut);
                uint256 finalStrike =
                    _getBestStrike(finalDelta, prevDelta, strike, isPut);
                require(
                    isPut
                        ? finalStrike <= assetPrice
                        : finalStrike >= assetPrice
                );
                // make decimals consistent with oToken strike price decimals (10 ** 8)
                return (
                    finalStrike.mul(10**8).div(assetOracleMultiplier),
                    finalDelta
                );
            }

            strike = isPut ? strike.sub(step) : strike.add(step);

            prevDelta = currDelta;
        }
    }

    /**
     * @notice Rounds to best delta value
     * @param prevDelta is the delta of the previous strike price
     * @param currDelta is delta of the current strike price
     * @param targetDelta is the delta we are targeting
     * @param isPut is whether its a put
     */
    function _getBestDelta(
        uint256 prevDelta,
        uint256 currDelta,
        uint256 targetDelta,
        bool isPut
    ) private pure returns (uint256 finalDelta) {
        uint256 upperBoundDiff =
            isPut ? sub(currDelta, targetDelta) : sub(prevDelta, targetDelta);
        uint256 lowerBoundDiff =
            isPut ? sub(targetDelta, prevDelta) : sub(targetDelta, currDelta);

        // for tie breaks (ex: 0.05 <= 0.1 <= 0.15) round to higher strike price
        // for calls and lower strike price for puts for deltas
        finalDelta = lowerBoundDiff <= upperBoundDiff
            ? (isPut ? prevDelta : currDelta)
            : (isPut ? currDelta : prevDelta);
    }

    /**
     * @notice Rounds to best delta value
     * @param finalDelta is the best delta value we found
     * @param prevDelta is delta of the previous strike price
     * @param strike is the strike of the previous iteration
     * @param isPut is whether its a put
     */
    function _getBestStrike(
        uint256 finalDelta,
        uint256 prevDelta,
        uint256 strike,
        bool isPut
    ) private view returns (uint256 finalStrike) {
        if (isPut) {
            if (finalDelta == prevDelta) {
                finalStrike = strike.add(step);
            } else {
                finalStrike = strike;
            }
        } else {
            if (finalDelta == prevDelta) {
                finalStrike = strike.sub(step);
            } else {
                finalStrike = strike;
            }
        }
    }

    /**
     * @notice Sets new delta value
     * @param newDelta is the new delta value
     */
    function setDelta(uint256 newDelta) external onlyOwner {
        uint256 oldDelta = delta;
        delta = newDelta;
        emit DeltaSet(oldDelta, newDelta, msg.sender);
    }

    /**
     * @notice Sets new step value
     * @param newStep is the new step value
     */
    function setStep(uint256 newStep) external onlyOwner {
        uint256 oldStep = step;
        step = newStep.mul(assetOracleMultiplier);
        emit StepSet(oldStep, newStep, msg.sender);
    }
}
