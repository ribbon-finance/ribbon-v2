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

contract PercentStrikeSelection is Ownable {
    using SafeMath for uint256;

    /**
     * Immutables
     */
    IOptionsPremiumPricer public immutable optionsPremiumPricer;

    // step in absolute terms at which we will increment
    // (ex: 100 * 10 ** assetOracleDecimals means we will move at increments of 100 points)
    uint256 public step;

    // multiplier for strike selection
    uint256 public strikeMultiplier;

    // multiplier to shift asset prices
    uint256 private immutable assetOracleMultiplier;

    // Delta are in 4 decimal places. 1 * 10**4 = 1 delta.
    uint256 private constant DELTA_MULTIPLIER = 10**4;

    // ChainLink's USD Price oracles return results in 8 decimal places
    uint256 private constant ORACLE_PRICE_MULTIPLIER = 10**8;

    // Strike multiplier has 2 decimal places. For example: 150 = 1.5x spot price
    uint256 private constant STRIKE_MULTIPLIER = 10**2;

    event StepSet(uint256 oldStep, uint256 newStep, address indexed owner);

    constructor(
        address _optionsPremiumPricer,
        uint256 _strikeMultiplier,
        uint256 _step
    ) {
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        require(
            _strikeMultiplier > STRIKE_MULTIPLIER,
            "Multiplier must be bigger than 1!"
        );
        require(_step > 0, "!_step");

        optionsPremiumPricer = IOptionsPremiumPricer(_optionsPremiumPricer);

        // ex: delta = 7500 (.75)
        uint256 _assetOracleMultiplier =
            10 **
                IPriceOracle(
                    IOptionsPremiumPricer(_optionsPremiumPricer).priceOracle()
                )
                    .decimals();

        step = _step;

        strikeMultiplier = _strikeMultiplier;

        assetOracleMultiplier = _assetOracleMultiplier;
    }

    /**
     * @notice Gets the strike price by multiplying the current underlying price
     * with a multiplier
     * @param expiryTimestamp is the unix timestamp of expiration
     * @param isPut is whether option is put or call
     * @return newStrikePrice is the strike price of the option (ex: for BTC might be 45000 * 10 ** 8)
     * @return newDelta will be set to zero for percent strike selection
     */

    function getStrikePrice(uint256 expiryTimestamp, bool isPut)
        external
        view
        returns (uint256 newStrikePrice, uint256 newDelta)
    {
        require(
            expiryTimestamp > block.timestamp,
            "Expiry must be in the future!"
        );

        // asset price
        uint256 strikePrice =
            optionsPremiumPricer.getUnderlyingPrice().mul(strikeMultiplier).div(
                STRIKE_MULTIPLIER
            );

        newStrikePrice = isPut
            ? strikePrice.sub(strikePrice % step)
            : strikePrice.add(step.sub(strikePrice % step));

        newDelta = 0;
    }

    /**
     * @notice Set the multiplier for setting the strike price
     * @param newStrikeMultiplier is the strike multiplier (decimals = 2)
     */
    function setStrikeMultiplier(uint256 newStrikeMultiplier)
        external
        onlyOwner
    {
        require(
            newStrikeMultiplier > STRIKE_MULTIPLIER,
            "Multiplier must be bigger than 1!"
        );
        strikeMultiplier = newStrikeMultiplier;
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
