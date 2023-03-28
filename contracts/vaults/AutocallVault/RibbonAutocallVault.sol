// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
    ) external initializer {
        RibbonThetaVault.initialize(
            _initParams,
            _vaultParams
        );

        require(_autocallBarrierPCT > PCT_MULTIPLIER, "!_autocallBarrierPCT");
        require(_couponBarrierPCT > PCT_MULTIPLIER && _couponBarrierPCT <= _autocallBarrierPCT, "!_couponBarrierPCT");
        require(autocallSeller != address(0), "!_autocallSeller");
        require(observationPeriodFreq > 0, "!_observationPeriodFreq");

        digitalOptionPayoffPCT = _digitalOptionPayoffPCT;
        autocallBarrierPCT = _autocallBarrierPCT;
        couponBarrierPCT = _couponBarrierPCT;
        observationPeriodFreq = _observationPeriodFreq;
        autocallSeller = _autocallSeller;
    }
}
