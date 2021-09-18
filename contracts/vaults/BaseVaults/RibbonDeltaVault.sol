// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {GnosisAuction} from "../../libraries/GnosisAuction.sol";
import {
    RibbonDeltaVaultStorage
} from "../../storage/RibbonDeltaVaultStorage.sol";
import {Vault} from "../../libraries/Vault.sol";
import {VaultLifecycle} from "../../libraries/VaultLifecycle.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";
import {RibbonVault} from "./base/RibbonVault.sol";
import {IRibbonThetaVault} from "../../interfaces/IRibbonThetaVault.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in RibbonDeltaVaultStorage.
 * RibbonDeltaVault should not inherit from any other contract aside from RibbonVault, RibbonDeltaVaultStorage
 */
contract RibbonDeltaVault is RibbonVault, RibbonDeltaVaultStorage {
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  EVENTS
     ***********************************************/

    event OpenLong(
        address indexed options,
        uint256 purchaseAmount,
        uint256 premium,
        address indexed manager
    );

    event CloseLong(
        address indexed options,
        uint256 profitAmount,
        address indexed manager
    );

    event NewOptionAllocationSet(
        uint256 optionAllocation,
        uint256 newOptionAllocation
    );

    event InstantWithdraw(
        address indexed account,
        uint256 share,
        uint256 round
    );

    event PlaceAuctionBid(
        uint256 auctionId,
        address indexed auctioningToken,
        uint256 sellAmount,
        uint256 buyAmount,
        address indexed bidder
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
     * @param _owner is the owner of the vault with critical permissions
     * @param _feeRecipient is the address to recieve vault performance and management fees
     * @param _managementFee is the management fee pct.
     * @param _performanceFee is the perfomance fee pct.
     * @param _tokenName is the name of the token
     * @param _tokenSymbol is the symbol of the token
     * @param _counterpartyThetaVault is the address of the counterparty theta
     vault of this delta vault
     * @param _optionAllocation is the pct of the funds to allocate towards the weekly option
     * @param _vaultParams is the struct with vault general data
     */
    function initialize(
        address _owner,
        address _keeper,
        address _feeRecipient,
        uint256 _managementFee,
        uint256 _performanceFee,
        string memory _tokenName,
        string memory _tokenSymbol,
        address _counterpartyThetaVault,
        uint256 _optionAllocation,
        Vault.VaultParams calldata _vaultParams
    ) external initializer {
        baseInitialize(
            _owner,
            _keeper,
            _feeRecipient,
            _managementFee,
            _performanceFee,
            _tokenName,
            _tokenSymbol,
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
        // 1000 = 10%. Needs to be less than 10% of the funds allocated to option.
        require(
            _optionAllocation > 0 &&
                _optionAllocation < 10 * Vault.OPTION_ALLOCATION_MULTIPLIER,
            "!_optionAllocation"
        );
        counterpartyThetaVault = IRibbonThetaVault(_counterpartyThetaVault);
        optionAllocation = _optionAllocation;
    }

    /**
     * @notice Updates the price per share of the current round. The current round
     * pps will change right after call rollToNextOption as the gnosis auction contract
     * takes custody of a % of `asset` tokens, and right after we claim the tokens from
     * the action as we may recieve some of `asset` tokens back alongside the oToken,
     * depending on the gnosis auction outcome. Finally it will change at the end of the week
     * if the oTokens are ITM
     */
    function updatePPS(bool isWithdraw) internal {
        uint256 currentRound = vaultState.round;
        if (
            !isWithdraw ||
            roundPricePerShare[currentRound] <= ShareMath.PLACEHOLDER_UINT
        ) {
            roundPricePerShare[currentRound] = ShareMath.pricePerShare(
                totalSupply(),
                IERC20(vaultParams.asset).balanceOf(address(this)),
                vaultState.totalPending,
                vaultParams.decimals
            );
        }
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new % allocation of funds towards options purchases (2 decimals. ex: 10 * 10**2 is 10%)
     * 0 < newOptionAllocation < 1000. 1000 = 10%.
     * @param newOptionAllocation is the option % allocation
     */
    function setOptionAllocation(uint16 newOptionAllocation)
        external
        onlyOwner
    {
        // Needs to be less than 10%
        require(
            newOptionAllocation > 0 &&
                newOptionAllocation < 10 * Vault.OPTION_ALLOCATION_MULTIPLIER,
            "Invalid allocation"
        );

        emit NewOptionAllocationSet(optionAllocation, newOptionAllocation);

        optionAllocation = newOptionAllocation;
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param share is the amount of shares to withdraw
     */
    function withdrawInstantly(uint256 share) external nonReentrant {
        require(share > 0, "!numShares");

        updatePPS(true);

        (uint256 sharesToWithdrawFromPending, uint256 sharesLeftForWithdrawal) =
            _withdrawFromNewDeposit(share);

        // Withdraw shares from pending amount
        if (sharesToWithdrawFromPending > 0) {
            vaultState.totalPending = uint128(
                uint256(vaultState.totalPending).sub(
                    sharesToWithdrawFromPending
                )
            );
        }
        uint256 currentRound = vaultState.round;

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

        uint256 withdrawAmount =
            ShareMath.sharesToAsset(
                share,
                roundPricePerShare[currentRound],
                vaultParams.decimals
            );
        transferAsset(msg.sender, withdrawAmount);
    }

    /**
     * @notice Closes the existing long position for the vault.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external nonReentrant {
        address oldOption = optionState.currentOption;

        address counterpartyNextOption =
            counterpartyThetaVault.optionState().nextOption;
        require(counterpartyNextOption != address(0), "!thetavaultclosed");

        updatePPS(true);

        optionState.nextOption = counterpartyNextOption;

        uint256 nextOptionReady = block.timestamp.add(DELAY);
        require(
            nextOptionReady <= type(uint32).max,
            "Overflow nextOptionReady"
        );
        optionState.nextOptionReadyAt = uint32(nextOptionReady);

        optionState.currentOption = address(0);
        vaultState.lastLockedAmount = uint104(balanceBeforePremium);

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
        onlyKeeper
        nonReentrant
    {
        (address newOption, uint256 lockedBalance) = _rollToNextOption();

        balanceBeforePremium = lockedBalance;

        GnosisAuction.BidDetails memory bidDetails;

        bidDetails.auctionId = counterpartyThetaVault.optionAuctionID();
        bidDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        bidDetails.oTokenAddress = newOption;
        bidDetails.asset = vaultParams.asset;
        bidDetails.assetDecimals = vaultParams.decimals;
        bidDetails.lockedBalance = lockedBalance;
        bidDetails.optionAllocation = optionAllocation;
        bidDetails.optionPremium = optionPremium;
        bidDetails.bidder = msg.sender;

        // place bid
        (uint256 sellAmount, uint256 buyAmount, uint64 userId) =
            VaultLifecycle.placeBid(bidDetails);

        auctionSellOrder.sellAmount = uint96(sellAmount);
        auctionSellOrder.buyAmount = uint96(buyAmount);
        auctionSellOrder.userId = userId;

        updatePPS(false);

        emit OpenLong(newOption, buyAmount, sellAmount, msg.sender);
    }

    /**
     * @notice Claims the delta vault's oTokens from latest auction
     */
    function claimAuctionOtokens() external nonReentrant {
        VaultLifecycle.claimAuctionOtokens(
            auctionSellOrder,
            GNOSIS_EASY_AUCTION,
            address(counterpartyThetaVault)
        );
        updatePPS(false);
    }

    /**
     * @notice Withdraws from the most recent deposit which has not been processed
     * @param share is how many shares to withdraw in total
     * @return the shares to remove from pending
     * @return the shares left to withdraw
     */
    function _withdrawFromNewDeposit(uint256 share)
        private
        returns (uint256, uint256)
    {
        Vault.DepositReceipt storage depositReceipt =
            depositReceipts[msg.sender];

        // Immediately get what is in the pending deposits, without need for checking pps
        if (
            depositReceipt.round == vaultState.round &&
            depositReceipt.amount > 0
        ) {
            uint256 receiptShares =
                ShareMath.assetToShares(
                    depositReceipt.amount,
                    roundPricePerShare[depositReceipt.round],
                    vaultParams.decimals
                );
            uint256 sharesWithdrawn = Math.min(receiptShares, share);
            // Subtraction underflow checks already ensure it is smaller than uint104
            depositReceipt.amount = uint104(
                ShareMath.sharesToAsset(
                    uint256(receiptShares).sub(sharesWithdrawn),
                    roundPricePerShare[depositReceipt.round],
                    vaultParams.decimals
                )
            );
            return (sharesWithdrawn, share.sub(sharesWithdrawn));
        }

        return (0, share);
    }
}
