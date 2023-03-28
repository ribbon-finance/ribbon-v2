// SPDX-License-Identifier: MIT
pragma solidity 0.8.10;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Vault} from "../../libraries/Vault.sol";
import {VaultLifecycle} from "../../libraries/VaultLifecycle.sol";
import {RibbonThetaVault} from "../BaseVaults/RibbonThetaVault.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in RibbonThetaVaultStorage.
 * RibbonThetaVault should not inherit from any other contract aside from RibbonVault, RibbonThetaVaultStorage
 */
contract RibbonAutocallVault is RibbonThetaVault {
    // Denominator for all pct calculations
    uint256 internal constant PCT_MULTIPLIER = 100**2;

    // State of current round's digital option (if DIP)
    DigitalOption public digitalOption;
    // Includes 2 decimals (i.e. 10500 = 105%)
    uint256 public autocallBarrierPCT;
    // Includes 2 decimals (i.e. 10500 = 105%)
    uint256 public couponBarrierPCT;
    // 1 day, 7 days, 1 month, etc in seconds
    uint256 public observationPeriodFreq;
    // Seller of the autocall - they are the counterparty for the short vanilla put + digital put
    address public autocallSeller;


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
     *  STRUCTS
     ***********************************************/

     struct DigitalOption {
       // Includes 2 decimals (i.e. 10500 = 105%)
       uint256 digitalOptionPayoffPCT;
       // Payoff denominated in vault collateral asset, changes every round
       uint256 digitalOptionPayoff;
       // Strike of digital option, changes every round
       uint256 digitalOptionStrike;
     }

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
        RibbonThetaVault(
            _weth,
            _usdc,
            _oTokenFactory,
            _gammaController,
            _marginPool,
            _gnosisEasyAuction
        )
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
        InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams,
        uint256 _digitalOptionPayoffPCT,
        uint256 _autocallBarrierPCT,
        uint256 _couponBarrierPCT,
        uint256 _observationPeriodFreq,
        address _autocallSeller
    ) external override(RibbonThetaVault) initializer {
        RibbonThetaVault.initialize(
            _initParams,
            _vaultParams
        );

        require(_autocallBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");
        require(_couponBarrierPCT > PCT_MULTIPLIER && _couponBarrierPCT <= _autocallBarrierPCT, "!_couponBarrierPCT");
        require(autocallSeller != address(0), "!_autocallSeller");
        require(observationPeriodFreq > 0, "!_observationPeriodFreq");

        digitalOption.digitalOptionPayoffPCT = _digitalOptionPayoffPCT;
        autocallBarrierPCT = _autocallBarrierPCT;
        couponBarrierPCT = _couponBarrierPCT;
        observationPeriodFreq = _observationPeriodFreq;
        autocallSeller = _autocallSeller;
    }

    /**
     * @notice Sets the new digital option payoff pct
     * @param _digitalOptionPayoffPCT is the digital option payoff pct
     */
    function setDigitalOptionPayoffPCT(uint256 _digitalOptionPayoffPCT)
        external
        onlyOwner
    {
        emit DigitalOptionPayoffPCTSet(digitalOption.digitalOptionPayoffPCT, _digitalOptionPayoffPCT);

        digitalOption.digitalOptionPayoffPCT = _digitalOptionPayoffPCT;
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
}
