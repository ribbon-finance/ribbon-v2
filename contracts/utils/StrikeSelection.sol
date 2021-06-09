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

    constructor(address _optionsPremiumPricer) {
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        optionsPremiumPricer = IOptionsPremiumPricer(_optionsPremiumPricer);
        // set delta to 0.1
        delta = 1;
        // set step to 5%
        step = 50;
    }

    /**
     * @notice Gets the strike price satisfying the delta value
     * given the expiry timestamp and whether option is call or put
     * @param expiryTimestamp is the unix timestamp of expiration
     * @param isPut is whether option is put or call
     */

    function getStrikePrice(uint256 expiryTimestamp, uint256 isPut)
        external
        returns (uint256 strikePrice)
    {
        volatilityOracle.commit();

        // asset price
        uint256 assetPrice = optionsPremiumPricer.getUnderlyingPrice();

        // time to expiration in number of days
        uint256 t = expiryTimestamp.sub(block.timestamp).div(1 days);

        // For each asset prices with step of 'margin' (down if put, up if call)
        //   if that assets getOptionDelta(currStrikePrice, t) == (isPut ? 1 - delta : delta) with certain margin of error
        //        return strike price

        bool pastDelta = false;
        uint256 currStrike = assetPrice;
        uint256 newDelta = isPut ? 10.sub(delta) : delta;

        while (!pastDelta) {
            uint256 currDelta =
                optionsPremiumPricer.getOptionDelta(currStrike, t);
            if (
                newDelta.sub(step.div(2).mul(newDelta)) <= currDelta &&
                currDelta <= newDelta.add(step.div(2).mul(newDelta))
            ) {
                strikePrice = currStrike;
            }
            currStrike = isPut
                ? currStrike.sub(currStrike.mul(step).div(1000))
                : currStrike.add(currStrike.mul(step).div(1000));
            if (isPut ? currDelta > newDelta : currDelta < newDelta) {
                pastDelta = true;
            }
        }

        return 0;
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
