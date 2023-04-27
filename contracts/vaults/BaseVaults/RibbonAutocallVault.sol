// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    AutocallVaultStorage
} from "../../storage/AutocallVaultStorage.sol";
import {IRibbonThetaVault} from "../../interfaces/IRibbonThetaVault.sol";
import {IRibbonThetaVault} from "../../interfaces/IRibbonThetaVault.sol";

import {
    IOtoken,
    IController,
    IOracle
  } from "../../interfaces/GammaInterface.sol";

contract RibbonAutocallVault is AutocallVaultStorage {
    // Denominator for all pct calculations
    uint256 internal constant PCT_MULTIPLIER = 100**2;

    IOracle public immutable ORACLE;
    IRibbonThetaVault public immutable TREASURY_THETA_VAULT;

    /************************************************
     *  EVENTS
     ***********************************************/

     event DigitalOptionSet(
         bool hasDigital
     );

     event AutocallBarrierPCTSet(
         uint256 autocallBarrierPCT,
         uint256 newAutocallBarrierPCT
     );

     event CouponBarrierPCTSet(
         uint256 couponBarrierPCT,
         uint256 newCouponBarrierPCT
     );

     event ObservationPeriodFreqSet(
         uint256 observationPeriodFreq,
         uint256 newObservationPeriodFreq
     );

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _treasuryThetaVault is the contract address of the treasury theta vault
     */
    constructor(
        IRibbonThetaVault _treasuryThetaVault
    )
    {
        ORACLE = IOracle(IController(_treasuryThetaVault.GAMMA_CONTROLLER()).oracle());
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _initParams is the struct with vault initialization parameters
     * @param _vaultParams is the struct with vault general data
     * @param _hasDigital is whether it includes digital put
     * @param _autocallBarrierPCT is autocall barrier
     * @param _couponBarrierPCT is coupon barrier
     * @param _observationPeriodFreq is frequency of observation period
     * @param _autocallSeller is counterparty of short vanilla put & digital put
     */
    function initialize(
        VaultLifecycleTreasury.InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams,
        bool _hasDigital,
        uint256 _autocallBarrierPCT,
        uint256 _couponBarrierPCT,
        uint256 _observationPeriodFreq,
        address _autocallSeller
    ) external initializer {
        _initialize(
            _initParams,
            _vaultParams
        );

        require(_autocallBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");
        require(_couponBarrierPCT > PCT_MULTIPLIER && _couponBarrierPCT <= _autocallBarrierPCT, "!_couponBarrierPCT");
        require(_autocallSeller != address(0), "!_autocallSeller");
        require(_observationPeriodFreq > 0 && _observationPeriodFreq <= period, "!_observationPeriodFreq");

        digitalOption.hasDigital = _hasDigital;
        autocallBarrierPCT = _autocallBarrierPCT;
        couponBarrierPCT = _couponBarrierPCT;
        observationPeriodFreq = _observationPeriodFreq;
        autocallSeller = _autocallSeller;
        numTotalObservationPeriods = period / _observationPeriodFreq;
    }

    /**
     * @dev Returns whether vault autocallable
     */
    function autocallable() external returns (uint256)
    {
      uint256 expiry = IOtoken(optionState.currentOption).expiryTimestamp();
      uint256 strikePrice = IOtoken(optionState.currentOption).strikePrice();
      return _autocallable(expiry, strikePrice);
    }

    /**
     * @notice Adds/removes digital option component
     */
    function setHasDigitalOption(bool _hasDigital)
        external
        onlyOwner
    {
        digitalOption.hasDigital = _hasDigital;
        emit DigitalOptionSet(_hasDigital);

    }

    /**
     * @notice Sets the new autocall barrier pct
     * @param _autocallBarrierPCT is the autocall payoff pct
     */
    function setAutocallBarrietPCT(uint256 _autocallBarrierPCT)
        external
        onlyOwner
    {
        require(_autocallBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");

        emit AutocallBarrierPCTSet(autocallBarrierPCT, _autocallBarrierPCT);

        pendingAutocallBarrierPCT = _autocallBarrierPCT;
    }

    /**
     * @notice Sets the new coupon barrier pct
     * @param _couponBarrierPCT is the coupon barrier pct
     */
    function setCouponBarrietPCT(uint256 _couponBarrierPCT)
        external
        onlyOwner
    {
        require(_couponBarrierPCT > PCT_MULTIPLIER && _couponBarrierPCT <= autocallBarrierPCT, "!_couponBarrierPCT");

        emit CouponBarrierPCTSet(couponBarrierPCT, _couponBarrierPCT);

        pendingCouponBarrierPCT = _couponBarrierPCT;
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

        emit ObservationPeriodFreqSet(observationPeriodFreq, _observationPeriodFreq);

        pendingObservationPeriodFreq = _observationPeriodFreq;
    }

    /**
     * @dev overrides RibbonTreasuryVault commitAndClose()
     */
    function commitAndClose()
        override
        external
        nonReentrant
    {

        IOtoken currentOToken = IOtoken(optionState.currentOption);
        uint256 expiry = currentOToken.expiryTimestamp();
        uint256 strikePrice = currentOToken.strikePrice();

        uint256 autocallTimestamp = expiry;
        // If before expiry, attempt to autocall
        if(expiry < block.timestamp){
          autocallTimestamp = _autocallable(expiry, strikePrice);
          // Require autocall barrier hit at least once
          require(autocallTimestamp > 0, "!autocall");
          // Burn the unexpired oTokens
          _burnRemainingOTokens();
          // Require vault possessed all oTokens sold to counterparties
          require(vaultState.lockedAmount == 0, "!withdrawnCollateral");
        }

        // Commit and close vanilla put
        RibbonTreasuryVault._commitAndClose();
        // Commit and close digital put
        _commitAndCloseDigital(expiry, strikePrice);
        // Return coupons
        _returnCoupons(autocallTimestamp);

        autocallBarrierPCT = pendingAutocallBarrierPCT;
        couponBarrierPCT = pendingCouponBarrierPCT;
        observationPeriodFreq = pendingObservationPeriodFreq;
        numTotalObservationPeriods = period / observationPeriodFreq;
    }

    /**
     * @dev settles the digital put
     * @param _expiry is the expiry of the current option
     * @param _strikePrice is the strike of the current option
     */
    function _commitAndCloseDigital(uint256 _expiry, uint256 _strikePrice) internal
    {
      // If there is no digital put, return
      if(digitalOption.payoffITM == 0){
        return;
      }

      // If digital put ITM, transfer to autocall seller
      if (_expiry > block.timestamp && ORACLE.getExpiryPrice(vaultParams.underlying, _expiry) <= _strikePrice){
        // Transfer current digital option payoff
        transferAsset(autocallSeller, digitalOption.payoffITM);
      }

      // Set next digital option payoff, strike
      if (digitalOption.hasDigital){
        // TODO: ADD MATH
        digitalOption.payoffITM = 0;
        digitalOption.strike = IOtoken(optionState.nextOption).strikePrice();
      }
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
    function _returnCoupons(uint256 _autocallTimestamp) internal
    {

    }

    /**
     * @dev Returns timestamp of first autocallable observation period, otherwise returns 0
     * @param _expiry is the expiry of the current option
     * @param _strikePrice is the strike of the current option
     */
    function _autocallable(uint256 _expiry, uint256 _strikePrice) internal returns (uint256)
    {
      uint256 _numTotalObservationPeriods = numTotalObservationPeriods;
      uint256 _observationPeriodFreq = observationPeriodFreq;
      for(uint i = _numTotalObservationPeriods; i > 0; i--){
        // Gets observation timestamp of observation index
        uint256 observationPeriodTimestamp = _expiry - (_numTotalObservationPeriods - i) * _observationPeriodFreq;
        uint256 observationPeriodPrice = ORACLE.getExpiryPrice(vaultParams.underlying, observationPeriodTimestamp);
        if(observationPeriodPrice >= _strikePrice * autocallBarrierPCT / PCT_MULTIPLIER){
          return observationPeriodTimestamp;
        }
      }

      return 0;
    }
}
