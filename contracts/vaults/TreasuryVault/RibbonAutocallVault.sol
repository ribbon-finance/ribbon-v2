// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AutocallVaultStorage} from "../../storage/AutocallVaultStorage.sol";
import {
    VaultLifecycleTreasury
} from "../../libraries/VaultLifecycleTreasury.sol";
import {Vault} from "../../libraries/Vault.sol";
import {RibbonTreasuryVaultLite} from "./RibbonTreasuryVaultLite.sol";

import {
    IOtoken,
    IController,
    IOracle
} from "../../interfaces/GammaInterface.sol";

/**
 * Autocall Vault Error Codes
 * A1: !_AB
 * A2: !FIXED
 * A3: !VANILLA
 * A4: !_CB
 * A5: !PHOENIX
 * A7: !_autocallSeller
 * A8: !_obsFreq
 * A9: !_period
 * A10: !autocall
 * A11: !withdrawnCollateral
 * A12: !obsPrice
 */

contract RibbonAutocallVault is RibbonTreasuryVaultLite, AutocallVaultStorage {
    // Denominator for all pct calculations
    uint256 internal constant PCT_MULTIPLIER = 100 * 10**2;

    IOracle public immutable ORACLE;

    /************************************************
     *  EVENTS
     ***********************************************/

    event OptionTypeSet(OptionType optionType);

    event CouponStateSet(
        CouponType couponType,
        uint256 newAutocallBarrierPCT,
        uint256 newCouponBarrierPCT
    );

    event PeriodAndObsFreqSet(
        uint256 obsFreq,
        uint256 newObservationPeriodFreq,
        uint256 period,
        uint256 newPeriod
    );

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _usdc is the USDC contract
     * @param _oTokenFactory is the contract address for minting new opyn option types (strikes, asset, expiry)
     * @param _gammaController is the contract address for opyn actions
     * @param _marginPool is the contract address for providing collateral to opyn
     */
    constructor(
        address _usdc,
        address _oTokenFactory,
        address _gammaController,
        address _marginPool
    )
        RibbonTreasuryVaultLite(
            _usdc,
            _oTokenFactory,
            _gammaController,
            _marginPool
        )
    {
        ORACLE = IOracle(IController(_gammaController).oracle());
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _initParams is the struct with vault initialization parameters
     * @param _vaultParams is the struct with vault general data
     * @param _optionType is type of the next put option
     * @param _couponState is the coupon state
     * @param _obsFreq is the observation frequency of autocall
     * @param _autocallSeller is the autocall seller
     */
    function initialize(
        VaultLifecycleTreasury.InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams,
        OptionType _optionType,
        CouponState calldata _couponState,
        uint256 _obsFreq,
        address _autocallSeller
    ) external initializer {
        _initialize(_initParams, _vaultParams);
        _verifyCouponState(
            _couponState.couponType,
            _couponState.AB,
            _couponState.CB
        );

        require(_autocallSeller != address(0), "A7");

        // Observation frequency must evenly divide the period
        require(_obsFreq > 0 && (period * 1 days) % _obsFreq == 0, "A8");

        putOption.nOptionType = _optionType;
        couponState.nCouponType = _couponState.couponType;
        couponState.nAB = _couponState.AB;
        couponState.nCB = _couponState.CB;

        nObsFreq = _obsFreq;
        nPeriod = period;
        autocallSeller = _autocallSeller;
        nAutocallSeller = _autocallSeller;
        numTotalObs = (period * 1 days) / _obsFreq;
    }

    /**
     * @dev Returns the last autocall observation timestamp and index
     * @return the last observation timestamp
     * @return the last observation index
     */
    function lastObservation() external view returns (uint256, uint256) {
        return
            _lastObservation(
                IOtoken(optionState.currentOption).expiryTimestamp()
            );
    }

    /**
     * @dev Gets coupons earned so far
     * @return the number of coupons earned
     * @return coupons earned in USDC
     * @return minimum between autocall timestamp and expiry
     */
    function couponsEarned()
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        (uint256 autocallTS, uint256 nCBBreaches, uint256 lastCBBreach) =
            _autocallState(
                IOtoken(optionState.currentOption).expiryTimestamp()
            );

        (uint256 nCouponsEarned, uint256 earnedAmt, ) =
            _couponsEarned(nCBBreaches, lastCBBreach);

        return (nCouponsEarned, earnedAmt, autocallTS);
    }

    /**
     * @notice Sets next option type
     * @param _optionType is the next option type
     */
    function setOptionType(OptionType _optionType) external onlyOwner {
        putOption.nOptionType = _optionType;
        emit OptionTypeSet(_optionType);
    }

    /**
     * @notice Sets the new coupon state
     * @param _couponType is the coupon type
     * @param _AB is the autocall barrier pct
     * @param _CB is the coupon barrier pct
     */
    function setCouponState(
        CouponType _couponType,
        uint256 _AB,
        uint256 _CB
    ) external onlyOwner {
        _verifyCouponState(_couponType, _AB, _CB);

        couponState.nCouponType = _couponType;
        couponState.nAB = _AB;
        couponState.nCB = _CB;

        emit CouponStateSet(_couponType, _AB, _CB);
    }

    /**
     * @notice Sets the new period and autocall observation period frequency
     * @param _period is the period
     * @param _obsFreq is the autocall observation period frequency
     */
    function setPeriodAndObservationFrequency(uint256 _period, uint256 _obsFreq)
        external
        onlyOwner
    {
        require(_period > 0, "A9");
        require(_obsFreq > 0 && (period * 1 days) % _obsFreq == 0, "A8");

        emit PeriodAndObsFreqSet(obsFreq, _obsFreq, period, _period);

        nObsFreq = _obsFreq;
        nPeriod = _period;
    }

    /**
     * @notice Sets the new autocall seller
     * @param _autocallSeller is the autocall seller address
     */
    function setAutocallSeller(address _autocallSeller) external onlyOwner {
        require(_autocallSeller != address(0), "A7");

        nAutocallSeller = _autocallSeller;
    }

    /**
     * @dev Overrides RibbonTreasuryVault commitAndClose()
     */
    function commitAndClose() external override nonReentrant {
        address currentOption = optionState.currentOption;

        IOtoken currentOToken = IOtoken(currentOption);
        uint256 expiry =
            currentOption == address(0) ? 0 : currentOToken.expiryTimestamp();
        uint256 strikePrice =
            currentOption == address(0) ? 0 : currentOToken.strikePrice();

        (uint256 autocallTS, uint256 nCBBreaches, uint256 lastCBBreach) =
            _autocallState(expiry);

        // Calculate coupons earned
        (, , uint256 returnAmt) = _couponsEarned(nCBBreaches, lastCBBreach);

        // If before expiry, attempt to autocall
        if (block.timestamp < expiry) {
            // Require autocall barrier hit at least once
            require(autocallTS < block.timestamp, "A10");
            // Burn the unexpired oTokens
            _burnRemainingOTokens();
            // Require vault possessed all oTokens sold to counterparties
            require(vaultState.lockedAmount == 0, "A11");
        }

        // Transfer unearned coupons back to autocall seller
        if (returnAmt > 0) {
            transferAsset(autocallSeller, returnAmt);
        }

        // Commit and close otoken put
        super._commitAndClose();

        // Commit and close enhanced put
        _commitAndCloseEnhancedPut(expiry, strikePrice);

        // Set coupon state
        CouponState memory _couponState = couponState;
        couponState.couponType = _couponState.nCouponType;
        couponState.AB = _couponState.nAB;
        couponState.CB = _couponState.nCB;

        // Set observation period frequency
        obsFreq = nObsFreq;
        period = nPeriod;
        numTotalObs = (period * 1 days) / obsFreq;

        // Set autocall seller
        autocallSeller = nAutocallSeller;
    }

    /**
     * @dev Commit and close the enhanced put
     * @param _expiry is the expiry of the current option
     * @param _oldStrikePrice is the strike of the current option
     */
    function _commitAndCloseEnhancedPut(
        uint256 _expiry,
        uint256 _oldStrikePrice
    ) internal {
        uint256 expiryPrice =
            ORACLE.getExpiryPrice(vaultParams.underlying, _expiry);

        PutOption memory _putOption = putOption;

        // If enhanced put ITM, transfer to autocall seller
        if (
            _putOption.payoff > 0 &&
            expiryPrice <= _oldStrikePrice &&
            block.timestamp > _expiry
        ) {
            // Transfer current downside option payoff
            transferAsset(
                autocallSeller,
                (oTokenMintAmount * _putOption.payoff) /
                    10**Vault.OTOKEN_DECIMALS
            );
        }

        uint256 _spotPrice = ORACLE.getPrice(vaultParams.underlying);
        uint256 _strikePrice = IOtoken(optionState.nextOption).strikePrice();

        // Set next option reserve ratio
        _setReserveRatio(_putOption.nOptionType, _spotPrice, _strikePrice);

        // Set next option payoff
        putOption.payoff = _setPutOptionPayoff(
            _putOption.nOptionType,
            _spotPrice,
            _strikePrice
        );
        putOption.optionType = _putOption.nOptionType;

        initialSpotPrice = _spotPrice;
    }

    /**
     * @dev Sets the reserve ratio
     * @param _nOptionType is the type of the next option
     * @param _price is the spot price of the new option
     * @param _nextStrikePrice is the strike price of the next option
     */
    function _setReserveRatio(
        OptionType _nOptionType,
        uint256 _price,
        uint256 _nextStrikePrice
    ) internal {
        /**
         * VANILLA:     only lock lockedBalance * strike / initial spot price
         * DIP:         only lock lockedBalance * strike / initial spot price
         * LEVERAGED:   lock lockedBalance (default is leveraged put)
         */
        if (
            _nOptionType == OptionType.VANILLA || _nOptionType == OptionType.DIP
        ) {
            reserveRatio =
                ((_price - _nextStrikePrice) * 10**Vault.OTOKEN_DECIMALS) /
                _price;
        } else {
            reserveRatio = 0;
        }
    }

    /**
     * @dev Sets the option payoff
     * @param _nOptionType is the type of the next option
     * @param _price is the spot price of the new option
     * @param _nextStrikePrice is the strike price of the next option
     * @return payoff is the enhanced payoff amount
     */
    function _setPutOptionPayoff(
        OptionType _nOptionType,
        uint256 _price,
        uint256 _nextStrikePrice
    ) internal view returns (uint256 payoff) {
        /**
         * VANILLA:   enhanced payout is: 0
         * DIP:       enhanced payout is:
         *            expiry of previous option -
         *            current strike price
         *            (DIP barrier = strike of vanilla put)
         * LEVERAGED: enhanced payout is: 0
         */

        if (_nOptionType == OptionType.DIP) {
            payoff = _price - _nextStrikePrice;
        }

        uint256 decimals = vaultParams.decimals;
        payoff = decimals > Vault.OTOKEN_DECIMALS
            ? payoff * 10**(decimals - Vault.OTOKEN_DECIMALS)
            : payoff / 10**(Vault.OTOKEN_DECIMALS - decimals);
    }

    /**
     * @dev Returns coupons earned info
     * @param nCBBreaches the number of observations above coupon barrier
     * @param lastCBBreach the last observation to breach coupon barrier
     * @return nCouponsEarned is the number of coupons earned
     * @return earnedAmt is the autocall buyer earned amount
     * @return returnAmt is the amount to return to autocallSeller
     */
    function _couponsEarned(uint256 nCBBreaches, uint256 lastCBBreach)
        internal
        view
        returns (
            uint256 nCouponsEarned,
            uint256 earnedAmt,
            uint256 returnAmt
        )
    {
        uint256 nonLockedAmt =
            (vaultState.lockedAmount * reserveRatio) /
                (10**Vault.OTOKEN_DECIMALS - reserveRatio);

        uint256 totalPremium =
            IERC20(vaultParams.asset).balanceOf(address(this)) -
                vaultState.totalPending -
                nonLockedAmt;

        /**
         * FIXED:           coupon barrier is 0, so nCBBreaches will always equal
         *                  total number of observations
         * PHOENIX:         only get the coupon for observations where
         *                  the spot was above coupon barrier
         * PHOENIX_MEMORY:  the last coupon barrier breach observation
         *                  will get us the total coupons earned
         * VANILLA:         coupon barrier = autocall barrier so
         *                  the last coupon barrier breach observation being non-zero
         *                  means autocall barrier has been hit and we get all previous
         *                  coupons
         */
        bool hasMemory =
            (couponState.couponType == CouponType.PHOENIX_MEMORY ||
                couponState.couponType == CouponType.VANILLA)
                ? true
                : false;
        nCouponsEarned = hasMemory ? lastCBBreach : nCBBreaches;
        earnedAmt = (totalPremium * nCouponsEarned) / numTotalObs;
        returnAmt = totalPremium - earnedAmt;
    }

    /**
     * @dev Gets autocall state
     * @param _expiry is the expiry of the current option
     * @return autocallTS the timestamp of first autocallable observation period, otherwise returns _expiry
     * @return nCBBreaches the number of observations above coupon barrier
     * @return lastCBBreach the last observation to breach coupon barrier
     */
    function _autocallState(uint256 _expiry)
        internal
        view
        returns (
            uint256 autocallTS,
            uint256 nCBBreaches,
            uint256 lastCBBreach
        )
    {
        if (_expiry == 0) {
            return (0, 0, 0);
        }

        uint256 startTS = _expiry - (numTotalObs - 1) * obsFreq;
        (, uint256 lastTS) = _lastObservation(_expiry);
        address underlying = vaultParams.underlying;

        autocallTS = _expiry;

        // For every previous observation timestamp
        for (uint256 ts = startTS; ts <= lastTS; ts += obsFreq) {
            uint256 obsPrice = ORACLE.getExpiryPrice(underlying, ts);
            require(obsPrice > 0, "A12");
            // If coupon barrier breached
            if (
                obsPrice >= (initialSpotPrice * couponState.CB) / PCT_MULTIPLIER
            ) {
                nCBBreaches += 1;
                lastCBBreach = ts;

                // If autocall barrier breached
                if (
                    obsPrice >=
                    (initialSpotPrice * couponState.AB) / PCT_MULTIPLIER
                ) {
                    autocallTS = ts;
                    break;
                }
            }
        }

        // Convert to index
        if (lastCBBreach > 0) {
            lastCBBreach = numTotalObs - (_expiry - lastCBBreach) / obsFreq;
        }
    }

    /**
     * @dev Returns the last observation timestamp and index
     * @param _expiry is current option expiry
     * @return index is last observation index
     * @return ts is last observation timestamp
     */
    function _lastObservation(uint256 _expiry)
        internal
        view
        returns (uint256 index, uint256 ts)
    {
        index =
            numTotalObs -
            (
                _expiry > block.timestamp
                    ? (_expiry - block.timestamp + obsFreq) / obsFreq
                    : 0
            );
        ts = _expiry - (numTotalObs - index) * obsFreq;
    }

    /**
     * @dev Verifies the coupon state is valid
     * @param _couponType is the coupon type
     * @param _AB is the autocall barrier pct
     * @param _CB is the coupon barrier pct
     */
    function _verifyCouponState(
        CouponType _couponType,
        uint256 _AB,
        uint256 _CB
    ) internal pure {
        require(_AB >= PCT_MULTIPLIER, "A1");

        if (_couponType == CouponType.FIXED) {
            // Coupon Barrier = 0
            require(_CB == 0, "A2");
        } else if (_couponType == CouponType.VANILLA) {
            // Coupon Barrier = Autocall Barrier
            require(_CB == _AB, "A3");
        } else {
            // Coupon Barrier < Autocall Barrier
            require(_CB > 0, "A4");
            require(_CB < _AB, "A5");
        }
    }
}
