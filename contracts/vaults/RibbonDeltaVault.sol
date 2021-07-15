// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {GnosisAuction} from "../libraries/GnosisAuction.sol";
import {OptionsDeltaVaultStorage} from "../storage/OptionsVaultStorage.sol";
import {Vault} from "../libraries/Vault.sol";
import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {RibbonVault} from "./base/RibbonVault.sol";
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";
import {IGnosisAuction} from "../interfaces/IGnosisAuction.sol";

contract RibbonDeltaVault is RibbonVault, OptionsDeltaVaultStorage {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /************************************************
     *  EVENTS
     ***********************************************/

    event OpenLong(
        address indexed options,
        uint256 purchaseAmount,
        uint256 premium,
        address manager
    );

    event CloseLong(
        address indexed options,
        uint256 profitAmount,
        address manager
    );

    event NewOptionAllocationSet(
        uint256 optionAllocationPct,
        uint256 newOptionAllocationPct
    );

    event PlaceAuctionBid(
        uint256 auctionId,
        address auctioningToken,
        uint256 sellAmount,
        uint256 buyAmount,
        address bidder
    );

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     * @param _gammaController is the contract address for opyn actions
     * @param _marginPool is the contract address for providing collateral to opyn
     * @param _gnosisEasyAuction is the contract address that facilitates gnosis auctions
     */
    constructor(
        address _weth,
        address _usdc,
        address _gammaController,
        address _marginPool,
        address _gnosisEasyAuction
    )
        RibbonVault(
            _weth,
            _usdc,
            _gammaController,
            _marginPool,
            _gnosisEasyAuction
        )
    {}

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     */
    function initialize(
        address _owner,
        address _feeRecipient,
        uint256 _managementFee,
        uint256 _performanceFee,
        string memory tokenName,
        string memory tokenSymbol,
        address _counterpartyThetaVault,
        uint256 _optionAllocationPct,
        Vault.VaultParams calldata _vaultParams
    ) external initializer {
        baseInitialize(
            _owner,
            _feeRecipient,
            _managementFee,
            _performanceFee,
            tokenName,
            tokenSymbol,
            _vaultParams
        );
        require(
            _counterpartyThetaVault != address(0),
            "!_counterpartyThetaVault"
        );
        require(
            IRibbonThetaVault(_counterpartyThetaVault).vaultParams().asset ==
                vaultParams.asset,
            "!_counterpartyThetaVault: asset"
        );
        require(
            _optionAllocationPct > 0 && _optionAllocationPct < 10000,
            "!_optionAllocationPct"
        );
        counterpartyThetaVault = IRibbonThetaVault(_counterpartyThetaVault);
        optionAllocationPct = _optionAllocationPct;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new % allocation of funds towards options purchases ( 3 decimals. ex: 55 * 10 ** 2 is 55%)
     * @param newOptionAllocationPct is the option % allocation
     */
    function setOptionAllocation(uint16 newOptionAllocationPct)
        external
        onlyOwner
    {
        // Needs to be less than 10%
        require(
            newOptionAllocationPct > 0 && newOptionAllocationPct < 1000,
            "Invalid allocation"
        );

        emit NewOptionAllocationSet(
            optionAllocationPct,
            newOptionAllocationPct
        );

        optionAllocationPct = newOptionAllocationPct;
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Closes the existing long position for the vault.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external onlyOwner nonReentrant {
        address oldOption = optionState.currentOption;

        address counterpartyNextOption =
            counterpartyThetaVault.optionState().nextOption;
        require(counterpartyNextOption != address(0), "!thetavaultclosed");
        optionState.nextOption = counterpartyNextOption;
        optionState.nextOptionReadyAt = uint32(block.timestamp.add(delay));

        optionState.currentOption = address(0);
        vaultState.lastLockedAmount = balanceBeforePremium;

        // redeem
        if (oldOption != address(0)) {
            uint256 profitAmount =
                VaultLifecycle.settleLong(
                    GAMMA_CONTROLLER,
                    oldOption,
                    vaultParams.asset
                );
            emit CloseLong(oldOption, profitAmount, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new long position.
     * @param optionPremium is the premium per token to pay in `asset`.
       Same decimals as `asset` (ex: 1 * 10 ** 8 means 1 WBTC per oToken)
     */
    function rollToNextOption(uint256 optionPremium)
        external
        onlyOwner
        nonReentrant
    {
        (address newOption, uint256 lockedBalance) = _rollToNextOption();

        balanceBeforePremium = uint104(lockedBalance);

        GnosisAuction.BidDetails memory bidDetails;

        bidDetails.auctionId = counterpartyThetaVault.optionAuctionID();
        bidDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        bidDetails.oTokenAddress = newOption;
        bidDetails.asset = vaultParams.asset;
        bidDetails.assetDecimals = vaultParams.decimals;
        bidDetails.lockedBalance = lockedBalance;
        bidDetails.optionAllocationPct = optionAllocationPct;
        bidDetails.optionPremium = optionPremium;
        bidDetails.bidder = msg.sender;

        // place bid
        (uint256 sellAmount, uint256 buyAmount, uint64 userId) =
            VaultLifecycle.placeBid(bidDetails);

        auctionSellOrder.sellAmount = uint96(sellAmount);
        auctionSellOrder.buyAmount = uint96(buyAmount);
        auctionSellOrder.userId = userId;

        emit OpenLong(newOption, buyAmount, sellAmount, msg.sender);
    }

    /**
     * @notice Claims the delta vault's oTokens from latest auction
     */
    function claimAuctionOtokens() external nonReentrant {
        bytes32 order =
            GnosisAuction.encodeOrder(
                auctionSellOrder.userId,
                auctionSellOrder.buyAmount,
                auctionSellOrder.sellAmount
            );
        bytes32[] memory orders = new bytes32[](1);
        orders[0] = order;
        IGnosisAuction(GNOSIS_EASY_AUCTION).claimFromParticipantOrder(
            counterpartyThetaVault.optionAuctionID(),
            orders
        );
    }
}
