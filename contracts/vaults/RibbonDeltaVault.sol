// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {DSMath} from "../vendor/DSMath.sol";
import {GnosisAuction} from "../libraries/GnosisAuction.sol";
import {OptionsDeltaVaultStorage} from "../storage/OptionsVaultStorage.sol";
import {Vault} from "../libraries/Vault.sol";
import {VaultLifecycle} from "../libraries/VaultLifecycle.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {RibbonVault} from "./base/RibbonVault.sol";
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";
import {IGnosisAuction} from "../interfaces/IGnosisAuction.sol";

contract RibbonDeltaVault is RibbonVault, DSMath, OptionsDeltaVaultStorage {
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

    event InstantWithdraw(address indexed account, uint256 share, uint16 round);

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

    /**
     * @notice Updates the price per share of the current round. The current round
     * pps will change right after call rollToNextOption as the gnosis auction contract
     * takes custody of a % of `asset` tokens, and right after we claim the tokens from
     * the action as we may recieve some of `asset` tokens back alongside the oToken,
     * depending on the gnosis auction outcome. Finally it will change at the end of the week
     * if the oTokens are ITM
     */
    modifier updatePPS(bool isWithdraw) {
        if (!isWithdraw) {
            _;
        }

        if (
            !isWithdraw ||
            roundPricePerShare[vaultState.round] <= PLACEHOLDER_UINT
        ) {
            uint256 pendingAmount = uint256(vaultState.totalPending);
            uint256 currentBalance =
                IERC20(vaultParams.asset).balanceOf(address(this));
            uint256 roundStartBalance = currentBalance.sub(pendingAmount);

            uint256 singleShare = 10**uint256(vaultParams.decimals);
            roundPricePerShare[vaultState.round] = VaultLifecycle.getPPS(
                totalSupply(),
                roundStartBalance,
                singleShare,
                vaultParams.initialSharePrice
            );
        }

        if (isWithdraw) {
            _;
        }
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

    /**
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param share is the amount of shares to withdraw
     */
    function withdrawInstantly(uint256 share)
        external
        updatePPS(true)
        nonReentrant
    {
        require(share > 0, "!shares");

        uint256 sharesLeftForWithdrawal = _withdrawFromNewDeposit(share);

        uint16 currentRound = vaultState.round;

        // If we need to withdraw beyond current round deposit
        if (sharesLeftForWithdrawal > 0) {
            (uint256 heldByAccount, uint256 heldByVault) =
                shareBalances(msg.sender);

            require(
                sharesLeftForWithdrawal <= heldByAccount.add(heldByVault),
                "Insufficient balance"
            );

            if (heldByAccount < sharesLeftForWithdrawal) {
                // Redeem all shares custodied by vault to user
                _redeem(0, true);
            }

            // Burn shares
            _burn(msg.sender, sharesLeftForWithdrawal);
        }

        emit InstantWithdraw(msg.sender, share, currentRound);

        uint256 sharesToUnderlying =
            ShareMath.sharesToUnderlying(
                share,
                roundPricePerShare[vaultState.round],
                vaultParams.decimals
            );
        transferAsset(msg.sender, sharesToUnderlying);
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Closes the existing long position for the vault.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external onlyOwner updatePPS(true) nonReentrant {
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
        updatePPS(false)
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
    function claimAuctionOtokens() external updatePPS(false) nonReentrant {
        VaultLifecycle.claimAuctionOtokens(
            auctionSellOrder,
            GNOSIS_EASY_AUCTION,
            address(counterpartyThetaVault)
        );
    }

    /**
     * @notice Withdraws from the most recent deposit which has not been processed
     * @param share is how many shares to withdraw in total
     * @return the shares left to withdraw
     */
    function _withdrawFromNewDeposit(uint256 share) private returns (uint256) {
        Vault.DepositReceipt storage depositReceipt =
            depositReceipts[msg.sender];

        // Immediately get what is in the pending deposits, without need for checking pps
        if (
            depositReceipt.round == vaultState.round &&
            depositReceipt.amount > 0
        ) {
            uint256 receiptShares =
                ShareMath.underlyingToShares(
                    depositReceipt.amount,
                    roundPricePerShare[depositReceipt.round],
                    vaultParams.decimals
                );
            uint256 sharesWithdrawn = min(receiptShares, share);
            // Subtraction underflow checks already ensure it is smaller than uint104
            depositReceipt.amount = uint104(
                ShareMath.sharesToUnderlying(
                    uint256(receiptShares).sub(sharesWithdrawn),
                    roundPricePerShare[depositReceipt.round],
                    vaultParams.decimals
                )
            );
            return share.sub(sharesWithdrawn);
        }

        return share;
    }
}
