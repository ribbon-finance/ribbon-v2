// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {
    IPriceOracle
} from "@ribbon-finance/rvol/contracts/interfaces/IPriceOracle.sol";
import {IOptionsPremiumPricer} from "../interfaces/IRibbon.sol";
import {
    IManualVolatilityOracle
} from "@ribbon-finance/rvol/contracts/interfaces/IManualVolatilityOracle.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import {Vault} from "../libraries/Vault.sol";

contract DeltaStrikeSelection is Ownable {
    using SafeMath for uint256;

    /**
     * Immutables
     */
    IOptionsPremiumPricer public immutable optionsPremiumPricer;

    IManualVolatilityOracle public immutable volatilityOracle;

    // delta for options strike price selection. 1 is 10000 (10**4)
    uint256 public delta;

    // step in absolute terms at which we will increment
    // (ex: 100 * 10 ** assetOracleDecimals means we will move at increments of 100 points)
    uint256 public step;

    // multiplier to shift asset prices
    uint256 private immutable assetOracleMultiplier;

    // Delta are in 4 decimal places. 1 * 10**4 = 1 delta.
    uint256 private constant DELTA_MULTIPLIER = 10**4;

    // ChainLink's USD Price oracles return results in 8 decimal places
    uint256 private constant ORACLE_PRICE_MULTIPLIER = 10**8;

    event DeltaSet(uint256 oldDelta, uint256 newDelta, address indexed owner);
    event StepSet(uint256 oldStep, uint256 newStep, address indexed owner);

    constructor(
        address _optionsPremiumPricer,
        uint256 _delta,
        uint256 _step
    ) {
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        require(_delta > 0, "!_delta");
        require(_delta <= DELTA_MULTIPLIER, "newDelta cannot be more than 1");
        require(_step > 0, "!_step");

        optionsPremiumPricer = IOptionsPremiumPricer(_optionsPremiumPricer);
        volatilityOracle = IManualVolatilityOracle(
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

        step = _step;

        assetOracleMultiplier = _assetOracleMultiplier;
    }

    /**
     * @notice Gets the strike price satisfying the delta value
     * given the expiry timestamp and whether option is call or put
     * @param expiryTimestamp is the unix timestamp of expiration
     * @param isPut is whether option is put or call
     * @return newStrikePrice is the strike price of the option (ex: for BTC might be 45000 * 10 ** 8)
     * @return newDelta is the delta of the option given its parameters
     */
    function getStrikePrice(uint256 expiryTimestamp, bool isPut)
        external
        view
        returns (uint256 newStrikePrice, uint256 newDelta)
    {
        // asset's annualized volatility
        uint256 annualizedVol =
            volatilityOracle.annualizedVol(optionsPremiumPricer.optionId()).mul(
                10**10
            );
        return _getStrikePrice(expiryTimestamp, isPut, annualizedVol);
    }

    /**
     * @notice Gets the strike price satisfying the delta value
     * given the expiry timestamp and whether option is call or put
     * @param expiryTimestamp is the unix timestamp of expiration
     * @param isPut is whether option is put or call
     * @param annualizedVol is IV of the asset at the specified delta
     * @return newStrikePrice is the strike price of the option (ex: for BTC might be 45000 * 10 ** 8)
     * @return newDelta is the delta of the option given its parameters
     */
    function getStrikePriceWithVol(
        uint256 expiryTimestamp,
        bool isPut,
        uint256 annualizedVol
    ) external view returns (uint256 newStrikePrice, uint256 newDelta) {
        return
            _getStrikePrice(expiryTimestamp, isPut, annualizedVol.mul(10**10));
    }

    /**
     * @notice Gets the strike price satisfying the delta value
     * given the expiry timestamp and whether option is call or put
     * @param expiryTimestamp is the unix timestamp of expiration
     * @param isPut is whether option is put or call
     * @return newStrikePrice is the strike price of the option (ex: for BTC might be 45000 * 10 ** 8)
     * @return newDelta is the delta of the option given its parameters
     */

    function _getStrikePrice(
        uint256 expiryTimestamp,
        bool isPut,
        uint256 annualizedVol
    ) internal view returns (uint256 newStrikePrice, uint256 newDelta) {
        require(
            expiryTimestamp > block.timestamp,
            "Expiry must be in the future!"
        );

        // asset price
        uint256 assetPrice = optionsPremiumPricer.getUnderlyingPrice();

        // For each asset prices with step of 'step' (down if put, up if call)
        //   if asset's getOptionDelta(currStrikePrice, spotPrice, annualizedVol, t) == (isPut ? 1 - delta:delta)
        //   with certain margin of error
        //        return strike price

        uint256 strike =
            isPut
                ? assetPrice.sub(assetPrice % step).sub(step)
                : assetPrice.add(step - (assetPrice % step)).add(step);
        uint256 targetDelta = isPut ? DELTA_MULTIPLIER.sub(delta) : delta;
        uint256 prevDelta = isPut ? 0 : DELTA_MULTIPLIER;

        while (true) {
            uint256 currDelta =
                optionsPremiumPricer.getOptionDelta(
                    assetPrice.mul(ORACLE_PRICE_MULTIPLIER).div(
                        assetOracleMultiplier
                    ),
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
                        : finalStrike >= assetPrice,
                    "Invalid strike price"
                );
                // make decimals consistent with oToken strike price decimals (10 ** 8)
                return (
                    finalStrike.mul(ORACLE_PRICE_MULTIPLIER).div(
                        assetOracleMultiplier
                    ),
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
     * @return the best delta value
     */
    function _getBestDelta(
        uint256 prevDelta,
        uint256 currDelta,
        uint256 targetDelta,
        bool isPut
    ) private pure returns (uint256) {
        uint256 finalDelta;

        // for tie breaks (ex: 0.05 <= 0.1 <= 0.15) round to higher strike price
        // for calls and lower strike price for puts for deltas
        if (isPut) {
            uint256 upperBoundDiff = currDelta.sub(targetDelta);
            uint256 lowerBoundDiff = targetDelta.sub(prevDelta);
            finalDelta = lowerBoundDiff <= upperBoundDiff
                ? prevDelta
                : currDelta;
        } else {
            uint256 upperBoundDiff = prevDelta.sub(targetDelta);
            uint256 lowerBoundDiff = targetDelta.sub(currDelta);
            finalDelta = lowerBoundDiff <= upperBoundDiff
                ? currDelta
                : prevDelta;
        }

        return finalDelta;
    }

    /**
     * @notice Rounds to best delta value
     * @param finalDelta is the best delta value we found
     * @param prevDelta is delta of the previous strike price
     * @param strike is the strike of the previous iteration
     * @param isPut is whether its a put
     * @return the best strike
     */
    function _getBestStrike(
        uint256 finalDelta,
        uint256 prevDelta,
        uint256 strike,
        bool isPut
    ) private view returns (uint256) {
        if (finalDelta != prevDelta) {
            return strike;
        }
        return isPut ? strike.add(step) : strike.sub(step);
    }

    /**
     * @notice Sets new delta value
     * @param newDelta is the new delta value
     */
    function setDelta(uint256 newDelta) external onlyOwner {
        require(newDelta > 0, "!newDelta");
        require(newDelta <= DELTA_MULTIPLIER, "newDelta cannot be more than 1");
        uint256 oldDelta = delta;
        delta = newDelta;
        emit DeltaSet(oldDelta, newDelta, msg.sender);
    }

    /**
     * @notice Sets new step value
     * @param newStep is the new step value
     */
    function setStep(uint256 newStep) external onlyOwner {
        require(newStep > 0, "!newStep");
        uint256 oldStep = step;
        step = newStep;
        emit StepSet(oldStep, newStep, msg.sender);
    }
}
