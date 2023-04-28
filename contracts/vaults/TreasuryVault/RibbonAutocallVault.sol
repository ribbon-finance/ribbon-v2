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

contract RibbonAutocallVault is RibbonTreasuryVaultLite, AutocallVaultStorage {
    // Denominator for all pct calculations
    uint256 internal constant PCT_MULTIPLIER = 100**2;

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

    event PeriodSet(uint256 period, uint256 newPeriod);

    event ObservationPeriodFreqSet(
        uint256 observationPeriodFreq,
        uint256 newObservationPeriodFreq
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
     */
    function initialize(
        VaultLifecycleTreasury.InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams,
        OptionType _optionType,
        CouponState calldata _couponState,
        uint256 _observationPeriodFreq,
        address _autocallSeller
    ) external initializer {
        _initialize(_initParams, _vaultParams);
        _verifyCouponState(
            _couponState.nextCouponType,
            _couponState.nextAutocallBarrierPCT,
            _couponState.nextCouponBarrierPCT
        );

        require(_autocallSeller != address(0), "!_autocallSeller");
        require(
            _observationPeriodFreq > 0 &&
                _observationPeriodFreq % 1 days == 0 &&
                _observationPeriodFreq <= period,
            "!_observationPeriodFreq"
        );

        putOption.nextOptionType = _optionType;
        couponState.nextCouponType = _couponState.nextCouponType;
        couponState.nextAutocallBarrierPCT = _couponState.autocallBarrierPCT;
        couponState.nextCouponBarrierPCT = _couponState.couponBarrierPCT;

        nextObservationPeriodFreq = _observationPeriodFreq;
        autocallSeller = _autocallSeller;
        numTotalObservationPeriods = period / _observationPeriodFreq;
    }

    /**
     * @dev Checks if vault autocallable
     * @return observation timestamp if autocallable, otherwise 0
     * @return the number of coupons earned
     * @return last observation to hit coupon barrier
     */
    function autocallable()
        external
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        (
            uint256 autocallTimestamp,
            uint256 numCouponsEarned,
            uint256 lastCouponBarrierBreachObservation
        ) = _autocallable(IOtoken(optionState.currentOption).expiryTimestamp());
        return (
            autocallTimestamp,
            numCouponsEarned,
            lastCouponBarrierBreachObservation
        );
    }

    /**
     * @notice Sets next option type
     * @param _optionType is the next option type
     */
    function setOptionType(OptionType _optionType) external onlyOwner {
        putOption.nextOptionType = _optionType;
        emit OptionTypeSet(_optionType);
    }

    /**
     * @notice Sets the new coupon state
     * @param _couponType is the coupon type
     * @param _autocallBarrierPCT is the autocall barrier pct
     * @param _couponBarrierPCT is the coupon barrier pct
     */
    function setCouponState(
        CouponType _couponType,
        uint256 _autocallBarrierPCT,
        uint256 _couponBarrierPCT
    ) external onlyOwner {
        _verifyCouponState(_couponType, _autocallBarrierPCT, _couponBarrierPCT);

        couponState.nextCouponType = _couponType;
        couponState.nextAutocallBarrierPCT = _autocallBarrierPCT;
        couponState.nextCouponBarrierPCT = _couponBarrierPCT;

        emit CouponStateSet(
            _couponType,
            _autocallBarrierPCT,
            _couponBarrierPCT
        );
    }

    /**
     * @notice Sets the new period and observation period frequency
     * @param _period is the period
     * @param _observationPeriodFreq is the observation period frequency
     */
    function setPeriodAndObservationFrequency(
        uint256 _period,
        uint256 _observationPeriodFreq
    ) external onlyOwner {
        require(_period > 0, "!_period");
        require(
            _observationPeriodFreq > 0 &&
                _observationPeriodFreq % 1 days == 0 &&
                _observationPeriodFreq <= _period,
            "!_observationPeriodFreq"
        );

        emit ObservationPeriodFreqSet(
            observationPeriodFreq,
            _observationPeriodFreq
        );

        emit PeriodSet(period, _period);

        nextObservationPeriodFreq = _observationPeriodFreq;
        nextPeriod = _period;
    }

    /**
     * @dev Overrides RibbonTreasuryVault commitAndClose()
     */
    function commitAndClose() external override nonReentrant {
        address currentOption = optionState.currentOption;

        if (currentOption == address(0)) {
            // Commit and close vanilla put
            super._commitAndClose();
            // Commit and close enhanced put
            _commitAndCloseEnhancedPut(0, 0);
            return;
        }

        IOtoken currentOToken = IOtoken(currentOption);
        uint256 expiry = currentOToken.expiryTimestamp();

        (
            uint256 autocallTimestamp,
            uint256 numCouponsEarned,
            uint256 lastCouponBarrierBreachObservation
        ) = _autocallable(expiry);

        // If before expiry, attempt to autocall
        if (block.timestamp < expiry) {
            // Require autocall barrier hit at least once
            require(autocallTimestamp > 0, "!autocall");
            // Burn the unexpired oTokens
            _burnRemainingOTokens();
            // Require vault possessed all oTokens sold to counterparties
            require(vaultState.lockedAmount == 0, "!withdrawnCollateral");
        }

        // Commit and close vanilla put
        super._commitAndClose();

        // Commit and close enhanced put
        _commitAndCloseEnhancedPut(expiry, currentOToken.strikePrice());

        // Return coupons to issuer
        _returnCoupons(numCouponsEarned, lastCouponBarrierBreachObservation);

        // Set coupon state
        CouponState memory _couponState = couponState;
        couponState.currentCouponType = _couponState.nextCouponType;
        couponState.autocallBarrierPCT = _couponState.nextAutocallBarrierPCT;
        couponState.couponBarrierPCT = _couponState.nextCouponBarrierPCT;

        // Set observation period frequency
        observationPeriodFreq = nextObservationPeriodFreq;
        period = nextPeriod;
        numTotalObservationPeriods = period / observationPeriodFreq;
    }

    /**
     * @dev Settles the enhanced put
     * @param _expiry is the expiry of the current option
     * @param _strikePrice is the strike of the current option
     */
    function _commitAndCloseEnhancedPut(uint256 _expiry, uint256 _strikePrice)
        internal
    {
        uint256 expiryPrice =
            ORACLE.getExpiryPrice(vaultParams.underlying, _expiry);

        PutOption memory _putOption = putOption;

        // If put ITM, transfer to autocall seller
        if (_putOption.payoffITM > 0 && expiryPrice <= _strikePrice) {
            // Transfer current digital option payoff
            transferAsset(
                autocallSeller,
                oTokenMintAmount * _putOption.payoffITM
            );
        }

        uint256 _spotPrice = ORACLE.getPrice(vaultParams.underlying);

        // Set next option payoff
        putOption.payoffITM = _setPutOptionPayoff(
            _putOption.nextOptionType,
            _spotPrice,
            IOtoken(optionState.nextOption).strikePrice()
        );
        putOption.currentOptionType = _putOption.nextOptionType;

        initialSpotPrice = _spotPrice;
    }

    /**
     * @dev Sets the option payoff
     * @param _nextOptionType is the type of the next option
     * @param _price is the spot price of the new option
     * @param _nextStrikePrice is the strike price of the next option
     */
    function _setPutOptionPayoff(
        OptionType _nextOptionType,
        uint256 _price,
        uint256 _nextStrikePrice
    ) internal pure returns (uint256) {
        /**
         * VANILLA: enhanced payout is 0 since the oToken is already vanilla
         * DIP: enhanced payout is expiry of previous option - current strike price (barrier of DIP = strike of vanilla put)
         * SPREAD: TBD
         * LEVERAGED: TBD
         */
        if (_nextOptionType == OptionType.VANILLA) {
            return 0;
        } else if (_nextOptionType == OptionType.DIP) {
            return _price - _nextStrikePrice;
        }

        return 0;
    }

    /**
     * @dev Returns coupons back to autocall seller based on coupon type
     * @param numCouponsEarned is the number of coupons above the coupon barrier
     * period which breached autocall barrier
     */
    function _returnCoupons(
        uint256 numCouponsEarned,
        uint256 lastCouponBarrierBreachObservation
    ) internal {
        uint256 couponTotal =
            IERC20(vaultParams.asset).balanceOf(address(this)) -
                vaultState.totalPending;
        uint256 _numTotalObservationPeriods = numTotalObservationPeriods;

        uint256 couponEarnedAmount;

        /**
         * FIXED: coupon barrier is 0, so the last coupon barrier breach observation will
         *        simply give us the latest observation
         * PHOENIX: only get the coupon for observations where the spot was above coupon barrier
         * PHOENIX_MEMORY: the last coupon barrier breach observation will get us the total coupons
         *                 earned which is all the previous observations as well
         * VANILLA: coupon barrier = autocall barrier so the last coupon barrier breach observation
         *                 being non-zero means autocall barrier has been hit and we get all previous coupons
         */
        if (couponState.currentCouponType == CouponType.PHOENIX) {
            couponEarnedAmount =
                (couponTotal * numCouponsEarned) /
                _numTotalObservationPeriods;
        } else if (
            couponState.currentCouponType == CouponType.FIXED ||
            couponState.currentCouponType == CouponType.PHOENIX_MEMORY ||
            couponState.currentCouponType == CouponType.VANILLA
        ) {
            couponEarnedAmount =
                (couponTotal * lastCouponBarrierBreachObservation) /
                _numTotalObservationPeriods;
        }

        // Transfer unearned coupons back to autocall seller
        transferAsset(autocallSeller, couponTotal - couponEarnedAmount);
    }

    /**
     * @dev Checks if vault autocallable
     * @param _expiry is the expiry of the current option
     * @return autocallTimestamp the timestamp of first autocallable observation period, otherwise returns 0
     * @return numCouponsEarned the number of coupons earned
     * @return lastCouponBarrierBreachObservation the last observation to breach coupon barrier
     */
    function _autocallable(uint256 _expiry)
        internal
        view
        returns (
            uint256 autocallTimestamp,
            uint256 numCouponsEarned,
            uint256 lastCouponBarrierBreachObservation
        )
    {
        uint256 _observationPeriodFreq = observationPeriodFreq;
        uint256 _numTotalObservationPeriods = numTotalObservationPeriods;

        uint256 currentObservation =
            (_expiry - block.timestamp) / _observationPeriodFreq + 1;
        address underlying = vaultParams.underlying;

        uint256 autocallObservation = currentObservation;

        // For every previous observation timestamp
        for (uint256 i = currentObservation; i > 0; i--) {
            // Gets observation timestamp of observation index
            uint256 observationPeriodTimestamp =
                _expiry -
                    (_numTotalObservationPeriods - i) *
                    _observationPeriodFreq;

            uint256 observationPeriodPrice =
                ORACLE.getExpiryPrice(underlying, observationPeriodTimestamp);

            // Check if autocallable
            if (
                observationPeriodPrice >=
                (initialSpotPrice * couponState.autocallBarrierPCT) /
                    PCT_MULTIPLIER
            ) {
                autocallObservation = i;
                autocallTimestamp = observationPeriodTimestamp;
                break;
            }
        }

        // For every observation timestamp before autocall
        for (uint256 i = autocallObservation; i > 0; i--) {
            // Gets observation timestamp of observation index
            uint256 observationPeriodTimestamp =
                _expiry -
                    (_numTotalObservationPeriods - i) *
                    _observationPeriodFreq;

            uint256 observationPeriodPrice =
                ORACLE.getExpiryPrice(underlying, observationPeriodTimestamp);

            // Check if coupon barrier hit
            if (
                observationPeriodPrice >=
                (initialSpotPrice * couponState.couponBarrierPCT) /
                    PCT_MULTIPLIER
            ) {
                numCouponsEarned += 1;
                // Get latest observation to hit coupon barrier
                if (lastCouponBarrierBreachObservation == 0) {
                    lastCouponBarrierBreachObservation = i;
                }
            }
        }
    }

    /**
     * @dev Verifies the coupon state is valid
     * @param _couponType is the coupon type
     * @param _autocallBarrierPCT is the autocall barrier pct
     * @param _couponBarrierPCT is the coupon barrier pct
     */
    function _verifyCouponState(
        CouponType _couponType,
        uint256 _autocallBarrierPCT,
        uint256 _couponBarrierPCT
    ) internal pure {
        require(_autocallBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");

        if (_couponType == CouponType.FIXED) {
            // Coupon Barrier = 0
            require(_couponBarrierPCT == 0, "!FIXED");
        } else if (
            _couponType == CouponType.VANILLA || _couponType == CouponType.FIXED
        ) {
            // Coupon Barrier = Autocall Barrier
            require(_couponBarrierPCT == _autocallBarrierPCT, "!VANILLA");
        } else {
            // Coupon Barrier < Autocall Barrier
            require(_couponBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");
            require(_couponBarrierPCT < _autocallBarrierPCT, "!PHOENIX");
        }
    }
}
