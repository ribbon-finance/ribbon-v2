// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    AutocallVaultStorage
} from "../../storage/AutocallVaultStorage.sol";
import {
    VaultLifecycleTreasury
} from "../../libraries/VaultLifecycleTreasury.sol";
import {Vault} from "../../libraries/Vault.sol";
import {DigitalOption} from "../libraries/OptionType.sol";
import {RibbonTreasuryVault} from "../TreasuryVault/RibbonTreasuryVault.sol";

import {
    IOtoken,
    IController,
    IOracle
  } from "../interfaces/GammaInterface.sol";

contract RibbonAutocallVault is RibbonTreasuryVault, AutocallVaultStorage {
    // Denominator for all pct calculations
    uint256 internal constant PCT_MULTIPLIER = 100**2;

    IOracle public immutable ORACLE;

    /************************************************
     *  EVENTS
     ***********************************************/

     event DigitalOptionPayoffPCTSet(
         uint256 digitalOptionPayoffPCT,
         uint256 newDigitalOptionPayoffPCT
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
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     * @param _oTokenFactory is the contract address for minting new opyn option types (strikes, asset, expiry)
     * @param _gammaController is the contract address for opyn actions
     * @param _marginPool is the contract address for providing collateral to opyn
     * @param _gnosisEasyAuction is the contract address that facilitates gnosis auctions
     */
    constructor(
        address _weth,
        address _usdc,
        address _oTokenFactory,
        address _gammaController,
        address _marginPool,
        address _gnosisEasyAuction
    )
        RibbonTreasuryVault(
            _weth,
            _usdc,
            _oTokenFactory,
            _gammaController,
            _marginPool,
            _gnosisEasyAuction
        )

        ORACLE = IOracle(IController(_gammaController).oracle())
    {}

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _initParams is the struct with vault initialization parameters
     * @param _vaultParams is the struct with vault general data
     * @param _digitalOptionPayoffPCT is percentage payoff compared to notional, of digital put
     * @param _autocallBarrierPCT is autocall barrier
     * @param _couponBarrierPCT is coupon barrier
     * @param _observationPeriodFreq is frequency of observation period
     * @param _autocallSeller is counterparty of short vanilla put & digital put
     */
    function initialize(
        VaultLifecycleTreasury.InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams,
        uint256 _digitalOptionPayoffPCT,
        uint256 _autocallBarrierPCT,
        uint256 _couponBarrierPCT,
        uint256 _observationPeriodFreq,
        address _autocallSeller
    ) external override(RibbonTreasuryVault) initializer {
        RibbonTreasuryVault.initialize(
            _initParams,
            _vaultParams
        );

        require(_autocallBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");
        require(_couponBarrierPCT > PCT_MULTIPLIER && _couponBarrierPCT <= _autocallBarrierPCT, "!_couponBarrierPCT");
        require(_autocallSeller != address(0), "!_autocallSeller");
        require(_observationPeriodFreq > 0 && _observationPeriodFreq <= period, "!_observationPeriodFreq");

        digitalOption.payoffPCT = _digitalOptionPayoffPCT;
        autocallBarrierPCT = _autocallBarrierPCT;
        couponBarrierPCT = _couponBarrierPCT;
        observationPeriodFreq = _observationPeriodFreq;
        autocallSeller = _autocallSeller;
        numTotalObservationPeriods = period / _observationPeriodFreq;
    }

    /**
     * @dev Returns whether vault autocallable
     */
    function autocallable() external returns uint256
    {
      uint256 expiry = IOtoken(optionState.currentOption).expiryTimestamp()
      uint256 strikePrice = IOtoken(optionState.currentOption).strikePrice()
      return _autocallable(expiry, strikePrice);
    }

    /**
     * @notice Sets the new digital option payoff pct
     * @param _digitalOptionPayoffPCT is the digital option payoff pct
     */
    function setDigitalOptionPayoffPCT(uint256 _payoffPCT)
        external
        onlyOwner
    {
        emit DigitalOptionPayoffPCTSet(digitalOption.payoffPCT, _payoffPCT);
        if(_payoffPCT = 0){
          digitalOption = DigitalOption()
        }else{
          digitalOption.payoffPCT = _payoffPCT;
        }
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

        autocallBarrierPCT = _autocallBarrierPCT;
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

        couponBarrierPCT = _couponBarrierPCT;
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

        observationPeriodFreq = _observationPeriodFreq;
    }

    /**
     * @dev overrides RibbonTreasuryVault commitAndClose()
     */
    function commitAndClose()
        external
        override(RibbonTreasuryVault)
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
          // Require vault possesses all oTokens sold to counterparties
          require(currentOToken.balanceOf(address(this)) == currentOToken.totalSupply());
          // Burn the unexpired oTokens
          _burnRemainingOTokens();
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
      if(digitalOption.payoff == 0){
        return;
      }

      // If digital put ITM, transfer to autocall seller
      if (_expiry > block.timestamp && ORACLE.getExpiryPrice(vaultParams.underlying, _expiry) <= _strikePrice){
        // Transfer current digital option payoff
        transferAsset(autocallSeller, digitalOption.payoff);
      }

      // Set next digital option payoff, strike
      if (digitalOption.digitalOptionPayoffPCT > 0){
        // TODO: ADD MATH
        digitalOption.payoff = 0
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
    function _autocallable(uint256 _expiry, uint256 _strikePrice) internal returns uint256
    {
      for(uint i = numTotalObservationPeriods; i > 0; i--){
        uint256 observationPeriodTimestamp = _getObservationPeriodTimestamp(i);
        uint256 observationPeriodPrice = ORACLE.getExpiryPrice(vaultParams.underlying, observationPeriodTimestamp);
        if(observationPeriodPrice >= _strikePrice * autocallBarrierPCT / PCT_MULTIPLIER){
          return observationPeriodTimestamp;
        }
      }

      return 0;
    }

    /**
     * @dev Gets observation timestamp of observation index
     * @param _observationIndex observation index
     */
    function _getObservationPeriodTimestamp(uint256 _observationIndex) internal
    {
      return oTokenExpiry - (numTotalObservationPeriods - _observationIndex) * observationPeriodFreq;
    }
}
