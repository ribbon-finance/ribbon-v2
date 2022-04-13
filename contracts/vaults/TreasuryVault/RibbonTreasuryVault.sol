// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {
    ReentrancyGuardUpgradeable
} from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
    ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

import {Vault} from "../../libraries/Vault.sol";
import {
    VaultLifecycleTreasury
} from "../../libraries/VaultLifecycleTreasury.sol";
import {
    RibbonTreasuryVaultStorage
} from "../../storage/RibbonTreasuryVaultStorage.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";
import {IWETH} from "../../interfaces/IWETH.sol";
import {GnosisAuction} from "../../libraries/GnosisAuction.sol";
import {IERC20Detailed} from "../../interfaces/IERC20Detailed.sol";

contract RibbonTreasuryVault is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    RibbonTreasuryVaultStorage
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /// @notice WETH9 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
    address public immutable WETH;

    /// @notice USDC 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
    address public immutable USDC;

    /// @notice 15 minute timelock between commitAndClose and rollToNexOption.
    uint256 public constant DELAY = 0;

    // Number of weeks per year = 52.142857 weeks * FEE_MULTIPLIER = 52142857
    // Dividing by weeks per year requires doing num.mul(FEE_MULTIPLIER).div(WEEKS_PER_YEAR)
    uint256 private constant WEEKS_PER_YEAR = 52142857;

    // GAMMA_CONTROLLER is the top-level contract in Gamma protocol
    // which allows users to perform multiple actions on their vaults
    // and positions https://github.com/opynfinance/GammaProtocol/blob/master/contracts/core/Controller.sol
    address public immutable GAMMA_CONTROLLER;

    // MARGIN_POOL is Gamma protocol's collateral pool.
    // Needed to approve collateral.safeTransferFrom for minting otokens.
    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/core/MarginPool.sol
    address public immutable MARGIN_POOL;

    // GNOSIS_EASY_AUCTION is Gnosis protocol's contract for initiating auctions and placing bids
    // https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol
    address public immutable GNOSIS_EASY_AUCTION;

    /// OTOKEN_FACTORY is the factory contract used to spawn otokens. Used to lookup otokens.
    address public immutable OTOKEN_FACTORY;

    // The minimum duration for an option auction.
    uint256 private constant MIN_AUCTION_DURATION = 5 minutes;

    // The minimum amount above which premium distribution will occur during commitAndClose
    uint256 private constant MIN_DUST_AMOUNT = 10000000;

    /************************************************
     *  EVENTS
     ***********************************************/

    event Deposit(address indexed account, uint256 amount, uint256 round);

    event InitiateWithdraw(
        address indexed account,
        uint256 shares,
        uint256 round
    );

    event Redeem(address indexed account, uint256 share, uint256 round);

    event ManagementFeeSet(uint256 managementFee, uint256 newManagementFee);

    event PerformanceFeeSet(uint256 performanceFee, uint256 newPerformanceFee);

    event CapSet(uint256 oldCap, uint256 newCap);

    event Withdraw(address indexed account, uint256 amount, uint256 shares);

    event CollectManagementFee(
        uint256 managementFee,
        uint256 round,
        address indexed feeRecipient
    );

    event CollectPerformanceFee(
        uint256 performanceFee,
        uint256 round,
        address indexed feeRecipient
    );

    event DistributePremium(
        uint256 amount,
        uint256[] amounts,
        address[] recipients,
        uint256 round
    );

    event OpenShort(
        address indexed options,
        uint256 depositAmount,
        address indexed manager
    );

    event CloseShort(
        address indexed options,
        uint256 withdrawAmount,
        address indexed manager
    );

    event NewOptionStrikeSelected(uint256 strikePrice, uint256 delta);

    event PremiumDiscountSet(
        uint256 premiumDiscount,
        uint256 newPremiumDiscount
    );

    event AuctionDurationSet(
        uint256 auctionDuration,
        uint256 newAuctionDuration
    );

    event InstantWithdraw(
        address indexed account,
        uint256 amount,
        uint256 round
    );

    event InitiateGnosisAuction(
        address indexed auctioningToken,
        address indexed biddingToken,
        uint256 auctionCounter,
        address indexed manager
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
    ) {
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");
        require(_oTokenFactory != address(0), "!_oTokenFactory");
        require(_gammaController != address(0), "!_gammaController");
        require(_marginPool != address(0), "!_marginPool");
        require(_gnosisEasyAuction != address(0), "!_gnosisEasyAuction");

        WETH = _weth;
        USDC = _usdc;
        OTOKEN_FACTORY = _oTokenFactory;
        GAMMA_CONTROLLER = _gammaController;
        MARGIN_POOL = _marginPool;
        GNOSIS_EASY_AUCTION = _gnosisEasyAuction;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     */
    function initialize(
        VaultLifecycleTreasury.InitParams calldata _initParams,
        Vault.VaultParams calldata _vaultParams
    ) external initializer {
        VaultLifecycleTreasury.verifyInitializerParams(
            _initParams,
            _vaultParams,
            MIN_AUCTION_DURATION
        );

        __ReentrancyGuard_init();
        __ERC20_init(_initParams._tokenName, _initParams._tokenSymbol);
        __Ownable_init();
        transferOwnership(_initParams._owner);

        keeper = _initParams._keeper;
        period = _initParams._period;
        optionsPremiumPricer = _initParams._optionsPremiumPricer;
        strikeSelection = _initParams._strikeSelection;
        premiumDiscount = _initParams._premiumDiscount;
        auctionDuration = _initParams._auctionDuration;
        feeRecipient = _initParams._feeRecipient;
        performanceFee = _initParams._performanceFee;
        managementFee = _perRoundManagementFee(_initParams._managementFee);
        maxDepositors = _initParams._maxDepositors;
        minDeposit = _initParams._minDeposit;

        vaultParams = _vaultParams;
        vaultState.round = 1;

        uint256 assetBalance =
            IERC20(vaultParams.asset).balanceOf(address(this));
        ShareMath.assertUint104(assetBalance);
        vaultState.lastLockedAmount = uint104(assetBalance);
    }

    /**
     * @dev Throws if called by any account other than the keeper.
     */
    modifier onlyKeeper() {
        require(msg.sender == keeper, "!keeper");
        _;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new keeper
     * @param newKeeper is the address of the new keeper
     */
    function setNewKeeper(address newKeeper) external onlyOwner {
        require(newKeeper != address(0), "!newKeeper");
        keeper = newKeeper;
    }

    /**
     * @notice Sets the new fee recipient
     * @param newFeeRecipient is the address of the new fee recipient
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "!newFeeRecipient");
        require(newFeeRecipient != feeRecipient, "Must be new feeRecipient");
        feeRecipient = newFeeRecipient;
    }

    /**
     * @notice Sets the management fee for the vault
     * @param newManagementFee is the management fee (6 decimals). ex: 2 * 10 ** 6 = 2%
     */
    function setManagementFee(uint256 newManagementFee) external onlyOwner {
        require(
            newManagementFee < 100 * Vault.FEE_MULTIPLIER,
            "Invalid management fee"
        );

        managementFee = _perRoundManagementFee(newManagementFee);

        emit ManagementFeeSet(managementFee, newManagementFee);
    }

    /**
     * @notice Internal function to set the management fee for the vault
     * @param managementFee is the management fee (6 decimals). ex: 2 * 10 ** 6 = 2
     * @return perRoundManagementFee is the management divided by the number of rounds per year
     */
    function _perRoundManagementFee(uint256 managementFee)
        internal
        view
        returns (uint256)
    {
        uint256 _period = period;
        uint256 feeDivider =
            _period % 30 == 0
                ? Vault.FEE_MULTIPLIER * (12 / (_period / 30))
                : WEEKS_PER_YEAR / (_period / 7);

        // We are dividing annualized management fee by num weeks in a year
        return managementFee.mul(Vault.FEE_MULTIPLIER).div(feeDivider);
    }

    /**
     * @notice Sets the performance fee for the vault
     * @param newPerformanceFee is the performance fee (6 decimals). ex: 20 * 10 ** 6 = 20%
     */
    function setPerformanceFee(uint256 newPerformanceFee) external onlyOwner {
        require(
            newPerformanceFee < 100 * Vault.FEE_MULTIPLIER,
            "Invalid performance fee"
        );

        emit PerformanceFeeSet(performanceFee, newPerformanceFee);

        performanceFee = newPerformanceFee;
    }

    /**
     * @notice Sets a new cap for deposits
     * @param newCap is the new cap for deposits
     */
    function setCap(uint256 newCap) external onlyOwner {
        require(newCap > 0, "!newCap");
        ShareMath.assertUint104(newCap);
        emit CapSet(vaultParams.cap, newCap);
        vaultParams.cap = uint104(newCap);
    }

    /**
     * @notice Sets the new discount on premiums for options we are selling
     * @param newPremiumDiscount is the premium discount
     */
    function setPremiumDiscount(uint256 newPremiumDiscount) external onlyOwner {
        require(
            newPremiumDiscount > 0 &&
                newPremiumDiscount < 100 * Vault.PREMIUM_DISCOUNT_MULTIPLIER,
            "Invalid discount"
        );

        emit PremiumDiscountSet(premiumDiscount, newPremiumDiscount);

        premiumDiscount = newPremiumDiscount;
    }

    /**
     * @notice Sets the new auction duration
     * @param newAuctionDuration is the auction duration
     */
    function setAuctionDuration(uint256 newAuctionDuration) external onlyOwner {
        require(
            newAuctionDuration >= MIN_AUCTION_DURATION,
            "Invalid auction duration"
        );

        emit AuctionDurationSet(auctionDuration, newAuctionDuration);

        auctionDuration = newAuctionDuration;
    }

    /**
     * @notice Sets the new strike selection contract
     * @param newStrikeSelection is the address of the new strike selection contract
     */
    function setStrikeSelection(address newStrikeSelection) external onlyOwner {
        require(newStrikeSelection != address(0), "!newStrikeSelection");
        strikeSelection = newStrikeSelection;
    }

    /**
     * @notice Sets the new options premium pricer contract
     * @param newOptionsPremiumPricer is the address of the new strike selection contract
     */
    function setOptionsPremiumPricer(address newOptionsPremiumPricer)
        external
        onlyOwner
    {
        require(
            newOptionsPremiumPricer != address(0),
            "!newOptionsPremiumPricer"
        );
        optionsPremiumPricer = newOptionsPremiumPricer;
    }

    /**
     * @notice Optionality to set strike price manually
     * @param strikePrice is the strike price of the new oTokens (decimals = 8)
     */
    function setStrikePrice(uint128 strikePrice)
        external
        onlyOwner
        nonReentrant
    {
        require(strikePrice > 0, "!strikePrice");
        overriddenStrikePrice = strikePrice;
        lastStrikeOverrideRound = vaultState.round;
    }

    /**
     * @notice Set the maximum number of depositors
     * @param newMaxDepositors is the new cap for number of depositors
     */
    function setMaxDepositors(uint256 newMaxDepositors)
        external
        onlyOwner
        nonReentrant
    {
        require(newMaxDepositors > 0, "!newMaxDepositors");
        maxDepositors = newMaxDepositors;
    }

    /**
     * @notice Set the minimum deposit amount
     * @param newMinDeposit is the new minimum amount for deposit
     */
    function setMinDeposit(uint256 newMinDeposit)
        external
        onlyOwner
        nonReentrant
    {
        require(newMinDeposit > 0, "!newMinDeposit");
        minDeposit = newMinDeposit;
    }

    /************************************************
     *  DEPOSIT & WITHDRAWALS
     ***********************************************/

    /**
     * @notice Internal function to add new depositor address
     * @param newDepositor is the address to include in the depositors list
     */
    function _addDepositor(address newDepositor) internal {
        if (!depositorsMap[newDepositor]) {
            require(newDepositor != address(0), "Depositor address null");
            require(
                (depositorsArray.length + 1) <= maxDepositors,
                "Number of depositors exceeds limit"
            );

            depositorsMap[newDepositor] = true;
            depositorsArray.push(newDepositor);
        }
    }

    /**
     * @notice Remove addresses from depositors list
     * @param excludeDepositor is the address to exclude from the depositors list
     */
    function _removeDepositor(address excludeDepositor) internal {
        address[] storage array = depositorsArray;
        uint256 arrayLength = array.length;

        require(depositorsMap[excludeDepositor], "Depositor does not exist");

        depositorsMap[excludeDepositor] = false;

        for (uint256 i = 0; i < arrayLength - 1; i++) {
            if (excludeDepositor == array[i]) {
                (array[i], array[arrayLength - 1]) = (
                    array[arrayLength - 1],
                    array[i]
                );
            }
        }
        array.pop();
    }

    /**
     * @notice Deposits the `asset` from msg.sender.
     * @param amount is the amount of `asset` to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "!amount");

        _addDepositor(msg.sender);

        _depositFor(amount, msg.sender);

        // An approve() by the msg.sender is required beforehand
        IERC20(vaultParams.asset).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
    }

    /**
     * @notice Mints the vault shares to the creditor
     * @param amount is the amount of `asset` deposited
     * @param creditor is the address to receieve the deposit
     */
    function _depositFor(uint256 amount, address creditor) private {
        uint256 currentRound = vaultState.round;
        uint256 totalWithDepositedAmount = totalBalance().add(amount);

        Vault.DepositReceipt memory depositReceipt = depositReceipts[creditor];
        uint256 totalUserDeposit =
            accountVaultBalance(msg.sender).add(depositReceipt.amount).add(
                amount
            );

        require(totalWithDepositedAmount <= vaultParams.cap, "Exceed cap");
        require(
            totalWithDepositedAmount >= vaultParams.minimumSupply,
            "Insufficient balance"
        );
        require(totalUserDeposit >= minDeposit, "Minimum deposit not reached");

        emit Deposit(creditor, amount, currentRound);

        // If we have an unprocessed pending deposit from the previous rounds, we have to process it.
        uint256 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                currentRound,
                roundPricePerShare[depositReceipt.round],
                vaultParams.decimals
            );

        uint256 depositAmount = amount;

        // If we have a pending deposit in the current round, we add on to the pending deposit
        if (currentRound == depositReceipt.round) {
            uint256 newAmount = uint256(depositReceipt.amount).add(amount);
            depositAmount = newAmount;
        }

        ShareMath.assertUint104(depositAmount);

        depositReceipts[creditor] = Vault.DepositReceipt({
            round: uint16(currentRound),
            amount: uint104(depositAmount),
            unredeemedShares: uint128(unredeemedShares)
        });

        uint256 newTotalPending = uint256(vaultState.totalPending).add(amount);
        ShareMath.assertUint128(newTotalPending);

        vaultState.totalPending = uint128(newTotalPending);
    }

    /**
     * @notice Initiates a withdrawal that can be processed once the round completes
     * @param numShares is the number of shares to withdraw
     */
    function initiateWithdraw(uint256 numShares) external nonReentrant {
        require(numShares > 0, "!numShares");

        // We do a max redeem before initiating a withdrawal
        // But we check if they must first have unredeemed shares
        Vault.DepositReceipt storage depositReceipt =
            depositReceipts[msg.sender];

        if (depositReceipt.amount > 0 || depositReceipt.unredeemedShares > 0) {
            _redeem(0, true);
        }

        // This caches the `round` variable used in shareBalances
        uint256 currentRound = vaultState.round;
        Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];
        uint256 withdrawalRound = withdrawal.round;

        bool withdrawalIsSameRound = withdrawalRound == currentRound;

        emit InitiateWithdraw(msg.sender, numShares, currentRound);

        uint256 existingShares = uint256(withdrawal.shares);

        uint256 withdrawalShares;
        if (withdrawalIsSameRound) {
            withdrawalShares = existingShares.add(numShares);
        } else {
            require(existingShares == 0, "Existing withdraw");
            withdrawalShares = numShares;
            withdrawals[msg.sender].round = uint16(currentRound);
        }

        // Ensure withdrawal does not reduce user deposit below the minimum amount
        uint256 vaultDecimals = vaultParams.decimals;
        uint256 userBalance = accountVaultBalance(msg.sender);

        uint256 withdrawAmount =
            ShareMath.sharesToAsset(
                numShares,
                currentRound != 1
                    ? roundPricePerShare[currentRound - 1]
                    : 10**vaultDecimals,
                vaultDecimals
            );

        if (userBalance > withdrawAmount) {
            uint256 totalDeposit = userBalance.sub(withdrawAmount);
            require(totalDeposit >= minDeposit, "Minimum deposit not reached");
        }

        ShareMath.assertUint128(withdrawalShares);
        withdrawals[msg.sender].shares = uint128(withdrawalShares);

        uint256 newQueuedWithdrawShares =
            uint256(vaultState.queuedWithdrawShares).add(numShares);
        ShareMath.assertUint128(newQueuedWithdrawShares);
        vaultState.queuedWithdrawShares = uint128(newQueuedWithdrawShares);

        if (depositReceipt.amount == 0 && balanceOf(msg.sender) == numShares) {
            _removeDepositor(msg.sender);
        }

        _transfer(msg.sender, address(this), numShares);
    }

    /**
     * @notice Completes a scheduled withdrawal from a past round. Uses finalized pps for the round
     * @return withdrawAmount the current withdrawal amount
     */
    function _completeWithdraw() internal returns (uint256) {
        Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];

        uint256 withdrawalShares = withdrawal.shares;
        uint256 withdrawalRound = withdrawal.round;

        // This checks if there is a withdrawal
        require(withdrawalShares > 0, "Not initiated");

        require(withdrawalRound < vaultState.round, "Round not closed");

        // We leave the round number as non-zero to save on gas for subsequent writes
        withdrawals[msg.sender].shares = 0;
        vaultState.queuedWithdrawShares = uint128(
            uint256(vaultState.queuedWithdrawShares).sub(withdrawalShares)
        );

        uint256 withdrawAmount =
            ShareMath.sharesToAsset(
                withdrawalShares,
                roundPricePerShare[withdrawalRound],
                vaultParams.decimals
            );

        emit Withdraw(msg.sender, withdrawAmount, withdrawalShares);

        _burn(address(this), withdrawalShares);

        require(withdrawAmount > 0, "!withdrawAmount");
        transferAsset(msg.sender, withdrawAmount);

        return withdrawAmount;
    }

    /**
     * @notice Redeems shares that are owed to the account
     * @param numShares is the number of shares to redeem
     */
    function redeem(uint256 numShares) external nonReentrant {
        require(numShares > 0, "!numShares");
        _redeem(numShares, false);
    }

    /**
     * @notice Redeems the entire unredeemedShares balance that is owed to the account
     */
    function maxRedeem() external nonReentrant {
        _redeem(0, true);
    }

    /**
     * @notice Redeems shares that are owed to the account
     * @param numShares is the number of shares to redeem, could be 0 when isMax=true
     * @param isMax is flag for when callers do a max redemption
     */
    function _redeem(uint256 numShares, bool isMax) internal {
        Vault.DepositReceipt memory depositReceipt =
            depositReceipts[msg.sender];

        // This handles the null case when depositReceipt.round = 0
        // Because we start with round = 1 at `initialize`
        uint256 currentRound = vaultState.round;

        uint256 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                currentRound,
                roundPricePerShare[depositReceipt.round],
                vaultParams.decimals
            );

        numShares = isMax ? unredeemedShares : numShares;
        if (numShares == 0) {
            return;
        }
        require(numShares <= unredeemedShares, "Exceeds available");

        // If we have a depositReceipt on the same round, BUT we have some unredeemed shares
        // we debit from the unredeemedShares, but leave the amount field intact
        // If the round has past, with no new deposits, we just zero it out for new deposits.
        if (depositReceipt.round < currentRound) {
            depositReceipts[msg.sender].amount = 0;
        }

        ShareMath.assertUint128(numShares);
        depositReceipts[msg.sender].unredeemedShares = uint128(
            unredeemedShares.sub(numShares)
        );

        emit Redeem(msg.sender, numShares, depositReceipt.round);

        _transfer(address(this), msg.sender, numShares);
    }

    /**
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param amount is the amount to withdraw
     */
    function withdrawInstantly(uint256 amount) external nonReentrant {
        Vault.DepositReceipt storage depositReceipt =
            depositReceipts[msg.sender];

        uint256 currentRound = vaultState.round;
        require(amount > 0, "!amount");
        require(depositReceipt.round == currentRound, "Invalid round");

        uint256 receiptAmount = depositReceipt.amount;
        require(receiptAmount >= amount, "Exceed amount");

        uint256 userBalance =
            accountVaultBalance(msg.sender).add(receiptAmount);

        if (userBalance > amount) {
            uint256 totalUserDeposit = userBalance.sub(amount);
            require(
                totalUserDeposit >= minDeposit,
                "Minimum deposit not reached"
            );
        }

        // Subtraction underflow checks already ensure it is smaller than uint104
        depositReceipt.amount = uint104(receiptAmount.sub(amount));
        vaultState.totalPending = uint128(
            uint256(vaultState.totalPending).sub(amount)
        );

        emit InstantWithdraw(msg.sender, amount, currentRound);

        if (depositReceipt.amount == 0 && shares(msg.sender) == 0) {
            _removeDepositor(msg.sender);
        }

        transferAsset(msg.sender, amount);
    }

    /**
     * @notice Completes a scheduled withdrawal from a past round. Uses finalized pps for the round
     */
    function completeWithdraw() external nonReentrant {
        uint256 withdrawAmount = _completeWithdraw();
        lastQueuedWithdrawAmount = uint128(
            uint256(lastQueuedWithdrawAmount).sub(withdrawAmount)
        );
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /*
     * @notice Helper function that helps to save gas for writing values into the roundPricePerShare map.
     *         Writing `1` into the map makes subsequent writes warm, reducing the gas from 20k to 5k.
     *         Having 1 initialized beforehand will not be an issue as long as we round down share calculations to 0.
     * @param numRounds is the number of rounds to initialize in the map
     */
    function initRounds(uint256 numRounds) external nonReentrant {
        require(numRounds > 0, "!numRounds");

        uint256 _round = vaultState.round;
        for (uint256 i = 0; i < numRounds; i++) {
            uint256 index = _round + i;
            require(roundPricePerShare[index] == 0, "Initialized"); // AVOID OVERWRITING ACTUAL VALUES
            roundPricePerShare[index] = ShareMath.PLACEHOLDER_UINT;
        }
    }

    /*
     * @notice Helper function that performs most administrative tasks
     * such as setting next option, minting new shares, getting vault fees, etc.
     * @param lastQueuedWithdrawAmount is old queued withdraw amount
     * @return newOption is the new option address
     * @return lockedBalance is the new balance used to calculate next option purchase size or collateral size
     * @return queuedWithdrawAmount is the new queued withdraw amount for this round
     */
    function _rollToNextOption(uint256 lastQueuedWithdrawAmount)
        internal
        returns (
            address newOption,
            uint256 lockedBalance,
            uint256 queuedWithdrawAmount
        )
    {
        require(block.timestamp >= optionState.nextOptionReadyAt, "!ready");

        newOption = optionState.nextOption;
        require(newOption != address(0), "!nextOption");

        uint256 currentRound = vaultState.round;
        address recipient = feeRecipient;
        uint256 mintShares;
        uint256 managementFeeInAsset;
        {
            uint256 newPricePerShare;
            (
                lockedBalance,
                queuedWithdrawAmount,
                newPricePerShare,
                mintShares,
                managementFeeInAsset
            ) = VaultLifecycleTreasury.rollover(
                vaultState,
                VaultLifecycleTreasury.RolloverParams(
                    vaultParams.decimals,
                    IERC20(vaultParams.asset).balanceOf(address(this)),
                    totalSupply(),
                    lastQueuedWithdrawAmount,
                    currentRound != 1 ? managementFee : 0
                )
            );

            optionState.currentOption = newOption;
            optionState.nextOption = address(0);

            // Finalize the pricePerShare at the end of the round

            roundPricePerShare[currentRound] = newPricePerShare;

            emit CollectManagementFee(
                managementFeeInAsset,
                currentRound,
                recipient
            );

            vaultState.totalPending = 0;
            vaultState.round = uint16(currentRound + 1);
        }

        _mint(address(this), mintShares);

        if (managementFeeInAsset > 0) {
            transferAsset(payable(recipient), managementFeeInAsset);
        }

        return (newOption, lockedBalance, queuedWithdrawAmount);
    }

    /**
     * @notice Helper function to make an ERC20 transfer
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(address recipient, uint256 amount) internal {
        address asset = vaultParams.asset;
        IERC20(asset).safeTransfer(recipient, amount);
    }

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external nonReentrant {
        address oldOption = optionState.currentOption;

        VaultLifecycleTreasury.CloseParams memory closeParams =
            VaultLifecycleTreasury.CloseParams({
                OTOKEN_FACTORY: OTOKEN_FACTORY,
                USDC: USDC,
                currentOption: oldOption,
                delay: DELAY,
                lastStrikeOverrideRound: lastStrikeOverrideRound,
                overriddenStrikePrice: overriddenStrikePrice,
                period: period
            });

        (
            address otokenAddress,
            uint256 premium,
            uint256 strikePrice,
            uint256 delta
        ) =
            VaultLifecycleTreasury.commitAndClose(
                strikeSelection,
                optionsPremiumPricer,
                premiumDiscount,
                closeParams,
                vaultParams,
                vaultState
            );

        emit NewOptionStrikeSelected(strikePrice, delta);

        ShareMath.assertUint104(premium);
        currentOtokenPremium = uint104(premium);
        optionState.nextOption = otokenAddress;

        uint256 nextOptionReady = block.timestamp.add(DELAY);
        require(
            nextOptionReady <= type(uint32).max,
            "Overflow nextOptionReady"
        );
        optionState.nextOptionReadyAt = uint32(nextOptionReady);

        _closeShort(oldOption);

        // In case chargeAndDistribute was not called last round, call
        // the function to conclude last round's performance fee and distribution
        if (IERC20(USDC).balanceOf(address(this)) > MIN_DUST_AMOUNT) {
            _chargeAndDistribute();
        }
    }

    /**
     * @notice Closes the existing short position for the vault.
     */
    function _closeShort(address oldOption) private {
        uint256 lockedAmount = vaultState.lockedAmount;
        if (oldOption != address(0)) {
            vaultState.lastLockedAmount = uint104(lockedAmount);
        }
        vaultState.lockedAmount = 0;

        optionState.currentOption = address(0);

        if (oldOption != address(0)) {
            uint256 withdrawAmount =
                VaultLifecycleTreasury.settleShort(GAMMA_CONTROLLER);
            emit CloseShort(oldOption, withdrawAmount, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external onlyKeeper nonReentrant {
        (
            address newOption,
            uint256 lockedBalance,
            uint256 queuedWithdrawAmount
        ) = _rollToNextOption(uint256(lastQueuedWithdrawAmount));

        lastQueuedWithdrawAmount = queuedWithdrawAmount;

        ShareMath.assertUint104(lockedBalance);
        vaultState.lockedAmount = uint104(lockedBalance);

        emit OpenShort(newOption, lockedBalance, msg.sender);

        VaultLifecycleTreasury.createShort(
            GAMMA_CONTROLLER,
            MARGIN_POOL,
            newOption,
            lockedBalance
        );

        _startAuction();
    }

    /**
     * @notice Initiate the gnosis auction.
     */
    function startAuction() external onlyKeeper nonReentrant {
        _startAuction();
    }

    function _startAuction() private {
        GnosisAuction.AuctionDetails memory auctionDetails;

        uint256 currOtokenPremium = currentOtokenPremium;

        require(currOtokenPremium > 0, "!currentOtokenPremium");

        uint256 stableDecimals = IERC20Detailed(USDC).decimals();

        auctionDetails.oTokenAddress = optionState.currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = USDC;
        auctionDetails.assetDecimals = stableDecimals;
        auctionDetails.oTokenPremium = currOtokenPremium;
        auctionDetails.duration = auctionDuration;

        optionAuctionID = VaultLifecycleTreasury.startAuction(auctionDetails);
    }

    /**
     * @notice Burn the remaining oTokens left over from gnosis auction.
     */
    function burnRemainingOTokens() external onlyKeeper nonReentrant {
        uint256 unlockedAssetAmount =
            VaultLifecycleTreasury.burnOtokens(
                GAMMA_CONTROLLER,
                optionState.currentOption
            );

        vaultState.lockedAmount = uint104(
            uint256(vaultState.lockedAmount).sub(unlockedAssetAmount)
        );
    }

    /**
     * @notice Settles the round's Gnosis auction and distribute the premiums earned
     */
    function concludeOptionsSale() external onlyKeeper nonReentrant {
        VaultLifecycleTreasury.settleAuction(
            GNOSIS_EASY_AUCTION,
            optionAuctionID
        );

        if (IERC20(USDC).balanceOf(address(this)) > MIN_DUST_AMOUNT) {
            _chargeAndDistribute();
        }
    }

    /**
     * @notice Charge performance fee and distribute remaining to depositors addresses
     */
    function chargeAndDistribute() external onlyKeeper nonReentrant {
        _chargeAndDistribute();
    }

    /**
     * @notice Calculate performance fee and transfer to fee recipient
     */
    function _chargeAndDistribute() internal {
        IERC20 stableAsset = IERC20(USDC);
        uint256 stableBalance = stableAsset.balanceOf(address(this));

        require(stableBalance > 0, "no premium to distribute");

        _chargePerformanceFee(stableAsset, stableBalance);

        _distributePremium(
            stableAsset,
            stableAsset.balanceOf(address(this)) // Get the new balance
        );
    }

    /**
     * @notice Charge performance fee
     */
    function _chargePerformanceFee(IERC20 token, uint256 amount) internal {
        address recipient = feeRecipient;
        uint256 transferAmount =
            amount.mul(performanceFee).div(100 * Vault.FEE_MULTIPLIER);

        token.safeTransfer(recipient, transferAmount);

        // Performance fee for the round is charged after rollover
        // hence we need to adjust the round to the previous
        emit CollectPerformanceFee(
            transferAmount,
            vaultState.round - 1,
            recipient
        );
    }

    /**
     * @notice Distribute the premium to depositor addresses
     */
    function _distributePremium(IERC20 token, uint256 amount) internal {
        // Distribute to depositor address
        address[] storage _depositors = depositorsArray;
        uint256[] memory _amounts = new uint256[](_depositors.length);
        uint256 totalSupply = totalSupply() - lastQueuedWithdrawAmount;

        for (uint256 i = 0; i < _depositors.length; i++) {
            // Distribute to depositors proportional to the amount of
            // shares they own
            address depositorAddress = _depositors[i];
            _amounts[i] = shares(depositorAddress).mul(amount).div(totalSupply);

            token.safeTransfer(depositorAddress, _amounts[i]);
        }

        emit DistributePremium(
            amount,
            _amounts,
            _depositors,
            vaultState.round - 1
        );
    }

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Returns the asset balance held on the vault for the account
     * @param account is the address to lookup balance for
     * @return the amount of `asset` custodied by the vault for the user
     */
    function accountVaultBalance(address account)
        public
        view
        returns (uint256)
    {
        uint256 _decimals = vaultParams.decimals;
        uint256 assetPerShare =
            ShareMath.pricePerShare(
                totalSupply(),
                totalBalance(),
                vaultState.totalPending,
                _decimals
            );
        return
            ShareMath.sharesToAsset(shares(account), assetPerShare, _decimals);
    }

    /**
     * @notice Getter for returning the account's share balance including unredeemed shares
     * @param account is the account to lookup share balance for
     * @return the share balance
     */
    function shares(address account) public view returns (uint256) {
        (uint256 heldByAccount, uint256 heldByVault) = shareBalances(account);
        return heldByAccount.add(heldByVault);
    }

    /**
     * @notice Getter for returning the account's share balance split between account and vault holdings
     * @param account is the account to lookup share balance for
     * @return heldByAccount is the shares held by account
     * @return heldByVault is the shares held on the vault (unredeemedShares)
     */
    function shareBalances(address account)
        public
        view
        returns (uint256 heldByAccount, uint256 heldByVault)
    {
        Vault.DepositReceipt memory depositReceipt = depositReceipts[account];

        if (depositReceipt.round < ShareMath.PLACEHOLDER_UINT) {
            return (balanceOf(account), 0);
        }

        uint256 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                vaultState.round,
                roundPricePerShare[depositReceipt.round],
                vaultParams.decimals
            );

        return (balanceOf(account), unredeemedShares);
    }

    /**
     * @notice The price of a unit of share denominated in the `asset`
     */
    function pricePerShare() external view returns (uint256) {
        return
            ShareMath.pricePerShare(
                totalSupply(),
                totalBalance(),
                vaultState.totalPending,
                vaultParams.decimals
            );
    }

    /**
     * @notice Returns the vault's total balance, including the amounts locked into a short position
     * @return total balance of the vault, including the amounts locked in third party protocols
     */
    function totalBalance() public view returns (uint256) {
        return
            uint256(vaultState.lockedAmount).add(
                IERC20(vaultParams.asset).balanceOf(address(this))
            );
    }

    /**
     * @notice Returns the token decimals
     */
    function decimals() public view override returns (uint8) {
        return vaultParams.decimals;
    }

    /**
     * @notice Returns the maximum capacity of the vault in terms of the vault's asset
     */
    function cap() external view returns (uint256) {
        return vaultParams.cap;
    }

    /**
     * @notice Returns the date and time for the next options sale
     */
    function nextOptionReadyAt() external view returns (uint256) {
        return optionState.nextOptionReadyAt;
    }

    /**
     * @notice Returns the options specification for the current round
     */
    function currentOption() external view returns (address) {
        return optionState.currentOption;
    }

    /**
     * @notice Returns the options specification for the next round
     */
    function nextOption() external view returns (address) {
        return optionState.nextOption;
    }

    /**
     * @notice Returns total pending deposit for the current round
     */
    function totalPending() external view returns (uint256) {
        return vaultState.totalPending;
    }

    /**
     * @notice ERC20 _transfer override function
     */
    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal override {
        require(
            recipient == address(this) || sender == address(this),
            "Treasury rToken is not transferrable"
        );
        return ERC20Upgradeable._transfer(sender, recipient, amount);
    }
}
