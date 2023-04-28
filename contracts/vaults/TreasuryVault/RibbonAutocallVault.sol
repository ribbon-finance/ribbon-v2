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
     * @param _autocallBarrierPCT is autocall barrier
     * @param _couponBarrierPCT is coupon barrier
     * @param _observationPeriodFreq is frequency of observation period
     * @param _autocallSeller is counterparty of short vanilla put & digital put
     */
    function initialize(
        VaultLifecycleTreasury.InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams,
        OptionType _optionType,
        CouponState _couponState,
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
            _observationPeriodFreq > 0 && _observationPeriodFreq <= period,
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
     * @dev Returns whether vault autocallable
     */
    function autocallable() external view returns (uint256) {
        uint256 expiry = IOtoken(optionState.currentOption).expiryTimestamp();
        uint256 strikePrice = IOtoken(optionState.currentOption).strikePrice();
        return _autocallable(expiry, strikePrice);
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
     * @notice Sets the new observation period frequency
     * @param _observationPeriodFreq is the observation period frequency
     */
    function setObservationPeriodFrequency(uint256 _observationPeriodFreq)
        external
        onlyOwner
    {
        require(_observationPeriodFreq > 0, "!_observationPeriodFreq");

        emit ObservationPeriodFreqSet(
            observationPeriodFreq,
            _observationPeriodFreq
        );

        nextObservationPeriodFreq = _observationPeriodFreq;
    }

    /**
     * @notice Sets the new period and observation period frequency
     * @param _period is the period
     * @param _observationPeriodFreq is the observation period frequency
     */
    function setPeriod(uint256 _period, uint256 _observationPeriodFreq)
        external
        onlyOwner
    {
        require(_period > 0, "!_period");
        require(
            _observationPeriodFreq > 0 && _observationPeriodFreq <= _period,
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
            _commitAndCloseEnhancedPut(
                ORACLE.getPrice(vaultParams.underlying),
                0
            );
            return;
        }

        IOtoken currentOToken = IOtoken(currentOption);
        uint256 expiry = currentOToken.expiryTimestamp();
        uint256 strikePrice = currentOToken.strikePrice();

        uint256 autocallTimestamp = expiry;
        // If before expiry, attempt to autocall
        if (block.timestamp < expiry) {
            autocallTimestamp = _autocallable(expiry, strikePrice);
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
        _commitAndCloseEnhancedPut(expiry, strikePrice);

        // Return coupons
        _returnCoupons(autocallTimestamp);

        autocallBarrierPCT = nextAutocallBarrierPCT;
        couponBarrierPCT = nextCouponBarrierPCT;
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

        // Set next option payoff
        putOption.payoffITM = _setPutOptionPayoff(
            _putOption.nextOptionType,
            expiryPrice,
            IOtoken(optionState.nextOption).strikePrice()
        );
        putOption.currentOptionType = _putOption.nextOptionType;
    }

    /**
     * @dev Sets the option payoff
     * @param _nextOptionType is the type of the next option
     * @param _expiryPrice is the expiry price of the current option
     * @param _nextStrikePrice is the strike price of the next option
     */
    function _setPutOptionPayoff(
        OptionType _nextOptionType,
        uint256 _expiryPrice,
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
            return _expiryPrice - _nextStrikePrice;
        }

        return 0;
    }

    /**
     * @dev Returns coupons back to autocall seller
     *      based on barriers hit
     *
     *      If coupon barrier = autocall barrier, return all future coupons
     *      from point of autocall barrier being hit
     *
     *      If coupon barrier < autocall barrier, return all coupons of
     *      observation periods where coupon barrier < spot < autocall barrier.
     *      If autocall barrier also hit, return all future coupons from point
     *      of autocall barrier being hit
     *
     * @param _autocallTimestamp is the timestamp of observation
     * period which breached autocall barrier
     */
    function _returnCoupons(uint256 _autocallTimestamp) internal {}

    /**
     * @dev Returns timestamp of first autocallable observation period, otherwise returns 0
     * @param _expiry is the expiry of the current option
     * @param _strikePrice is the strike of the current option
     */
    function _autocallable(uint256 _expiry, uint256 _strikePrice)
        internal
        view
        returns (uint256)
    {
        uint256 _numTotalObservationPeriods = numTotalObservationPeriods;
        uint256 _observationPeriodFreq = observationPeriodFreq;
        for (uint256 i = _numTotalObservationPeriods; i > 0; i--) {
            // Gets observation timestamp of observation index
            uint256 observationPeriodTimestamp =
                _expiry -
                    (_numTotalObservationPeriods - i) *
                    _observationPeriodFreq;
            uint256 observationPeriodPrice =
                ORACLE.getExpiryPrice(
                    vaultParams.underlying,
                    observationPeriodTimestamp
                );
            if (
                observationPeriodPrice >=
                (_strikePrice * autocallBarrierPCT) / PCT_MULTIPLIER
            ) {
                return observationPeriodTimestamp;
            }
        }

        return 0;
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
        require(
            _couponState.autocallBarrierPCT > PCT_MULTIPLIER,
            "!_autocallBarrierPCT"
        );

        if (_couponType == CouponType.FIXED) {
            // Coupon Barrier = 0
            require(_couponBarrierPCT == 0, "!FIXED");
        } else if (_couponType == CouponType.VANILLA) {
            // Coupon Barrier = Autocall Barrier
            require(_couponBarrierPCT == _autocallBarrierPCT, "!VANILLA");
        } else {
            // Coupon Barrier < Autocall Barrier
            require(_couponBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");
            require(_couponBarrierPCT < _autocallBarrierPCT, "!PHOENIX");
        }
    }
}
