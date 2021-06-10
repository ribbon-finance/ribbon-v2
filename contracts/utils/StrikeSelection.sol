// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {DSMath} from "../lib/DSMath.sol";
import {IOptionsPremiumPricer} from "../interfaces/IRibbon.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StrikeSelection is DSMath, Ownable {
    using SafeMath for uint256;

    /**
     * Immutables
     */
    IOptionsPremiumPricer public immutable optionsPremiumPricer;

    // delta for options strike price selection (ex: 0.1 is 1)
    uint256 public delta;
    // step pct at which we will iterate over
    // (ex: 500 = 50% means we will move in leaps of 50% of spot price)
    uint256 public step;

    event DeltaSet(uint256 oldDelta, uint256 newDelta, address owner);
    event StepSet(uint256 oldStep, uint256 newStep, address owner);

    constructor(address _optionsPremiumPricer, uint256 _delta, uint256 _step) {
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        require(_delta > 0, "!_delta");
        require(_step > 0, "!_step");
        optionsPremiumPricer = IOptionsPremiumPricer(_optionsPremiumPricer);
        // ex: delta = 1
        delta = _delta;
        // ex: step = 10 (1%)
        step = _step;
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
        // asset price
        uint256 assetPrice = optionsPremiumPricer.getUnderlyingPrice();

        // For each asset prices with step of 'margin' (down if put, up if call)
        //   if asset's getOptionDelta(currStrikePrice, t) == (isPut ? 1 - delta:delta)
        //   with certain margin of error
        //        return strike price

        bool pastDelta = false;
        uint256 currStrike = assetPrice;
        uint256 newDelta = isPut ? uint256(10).sub(delta) : delta;

        while (!pastDelta) {
            uint256 currDelta =
                optionsPremiumPricer.getOptionDelta(
                    currStrike,
                    expiryTimestamp
                );
            if (
                newDelta.sub(step.div(2).mul(newDelta)) <= currDelta &&
                currDelta <= newDelta.add(step.div(2).mul(newDelta))
            ) {
                return (currStrike, currDelta);
            }
            currStrike = isPut
                ? currStrike.sub(currStrike.mul(step).div(1000))
                : currStrike.add(currStrike.mul(step).div(1000));
            if (isPut ? currDelta > newDelta : currDelta < newDelta) {
                pastDelta = true;
            }
        }

        return (0, 0);
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
        step = newStep;
        emit StepSet(oldStep, newStep, msg.sender);
    }
}
