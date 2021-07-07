// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {GnosisAuction} from "../../libraries/GnosisAuction.sol";
import {OptionsVaultStorage} from "../../storage/OptionsVaultStorage.sol";
import {Vault} from "../../libraries/Vault.sol";
import {VaultLifecycle} from "../../libraries/VaultLifecycle.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";
import {IOtoken} from "../../interfaces/GammaInterface.sol";
import {IWETH} from "../../interfaces/IWETH.sol";
import {IGnosisAuction} from "../../interfaces/IGnosisAuction.sol";
import {
    IStrikeSelection,
    IOptionsPremiumPricer
} from "../../interfaces/IRibbon.sol";

contract RibbonVault is OptionsVaultStorage {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    address public immutable WETH;
    address public immutable USDC;

    uint256 public constant delay = 1 hours;

    uint256 public constant period = 7 days;

    uint128 private constant PLACEHOLDER_UINT = 1;

    // GAMMA_CONTROLLER is the top-level contract in Gamma protocol
    // which allows users to perform multiple actions on their vaults
    // and positions https://github.com/opynfinance/GammaProtocol/blob/master/contracts/Controller.sol
    address public immutable GAMMA_CONTROLLER;

    // MARGIN_POOL is Gamma protocol's collateral pool.
    // Needed to approve collateral.safeTransferFrom for minting otokens.
    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/MarginPool.sol
    address public immutable MARGIN_POOL;

    // GNOSIS_EASY_AUCTION is Gnosis protocol's contract for initiating auctions and placing bids
    // https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol
    address public immutable GNOSIS_EASY_AUCTION;

    /************************************************
     *  EVENTS
     ***********************************************/

    event Deposit(address indexed account, uint256 amount, uint16 round);

    event InitiateWithdraw(address account, uint256 shares, uint16 round);

    event Withdraw(address indexed account, uint256 amount, uint256 share);

    event InstantWithdraw(
        address indexed account,
        uint256 amount,
        uint16 round
    );

    event Redeem(address indexed account, uint256 share, uint16 round);

    event WithdrawalFeeSet(uint256 oldFee, uint256 newFee);

    event ManagementFeeSet(uint256 managementFee, uint256 newManagementFee);

    event PerformanceFeeSet(uint256 performanceFee, uint256 newPerformanceFee);

    event CapSet(uint256 oldCap, uint256 newCap, address manager);

    event CollectVaultFees(
        uint256 performanceFee,
        uint256 vaultFee,
        uint256 round
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
    ) {
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");
        require(_gnosisEasyAuction != address(0), "!_gnosisEasyAuction");
        require(_gammaController != address(0), "!_gammaController");
        require(_marginPool != address(0), "!_marginPool");

        WETH = _weth;
        USDC = _usdc;
        GAMMA_CONTROLLER = _gammaController;
        MARGIN_POOL = _marginPool;
        GNOSIS_EASY_AUCTION = _gnosisEasyAuction;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     */
    function baseInitialize(
        address _owner,
        address _feeRecipient,
        uint256 _managementFee,
        uint256 _performanceFee,
        string memory tokenName,
        string memory tokenSymbol,
        Vault.VaultParams calldata _vaultParams
    ) internal initializer {
        VaultLifecycle.verifyConstructorParams(
            _owner,
            _feeRecipient,
            _performanceFee,
            tokenName,
            tokenSymbol,
            _vaultParams
        );

        __ReentrancyGuard_init();
        __ERC20_init(tokenName, tokenSymbol);
        __Ownable_init();
        transferOwnership(_owner);

        feeRecipient = _feeRecipient;
        performanceFee = _performanceFee;
        managementFee = _managementFee.div(uint256(365).div(7));
        vaultParams = _vaultParams;

        vaultState.round = 1;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new fee recipient
     * @param newFeeRecipient is the address of the new fee recipient
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "!newFeeRecipient");
        feeRecipient = newFeeRecipient;
    }

    /**
     * @notice Sets the management fee for the vault
     * @param newManagementFee is the management fee (6 decimals). ex: 2 * 10 ** 6 = 2%
     */
    function setManagementFee(uint256 newManagementFee) external onlyOwner {
        require(
            newManagementFee > 0 && newManagementFee < 100 * 10**6,
            "Invalid management fee"
        );

        emit ManagementFeeSet(managementFee, newManagementFee);

        // We are dividing annualized management fee by num weeks in a year
        managementFee = uint16(
            uint256(newManagementFee).div(uint256(365).div(7))
        );
    }

    /**
     * @notice Sets the performance fee for the vault
     * @param newPerformanceFee is the performance fee (6 decimals). ex: 20 * 10 ** 6 = 20%
     */
    function setPerformanceFee(uint256 newPerformanceFee) external onlyOwner {
        require(
            newPerformanceFee > 0 && newPerformanceFee < 100 * 10**6,
            "Invalid performance fee"
        );

        emit PerformanceFeeSet(performanceFee, newPerformanceFee);

        performanceFee = newPerformanceFee;
    }

    /**
     * @notice Sets a new cap for deposits
     * @param newCap is the new cap for deposits
     */
    function setCap(uint104 newCap) external onlyOwner {
        uint256 oldCap = vaultParams.cap;
        vaultParams.cap = newCap;
        emit CapSet(oldCap, newCap, msg.sender);
    }

    /************************************************
     *  DEPOSIT & WITHDRAWALS
     ***********************************************/

    /**
     * @notice Deposits ETH into the contract and mint vault shares. Reverts if the underlying is not WETH.
     */
    function depositETH() external payable nonReentrant {
        require(vaultParams.asset == WETH, "!WETH");
        require(msg.value > 0, "!value");

        _deposit(msg.value);

        IWETH(WETH).deposit{value: msg.value}();
    }

    /**
     * @notice Deposits the `asset` into the contract and mint vault shares.
     * @param amount is the amount of `asset` to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "!amount");

        _deposit(amount);

        IERC20(vaultParams.asset).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
    }

    /**
     * @notice Mints the vault shares to the msg.sender
     * @param amount is the amount of `asset` deposited
     */
    function _deposit(uint256 amount) private {
        uint16 currentRound = vaultState.round;
        uint256 totalWithDepositedAmount = totalBalance().add(amount);

        require(totalWithDepositedAmount < vaultParams.cap, "Exceed cap");
        require(
            totalWithDepositedAmount >= vaultParams.minimumSupply,
            "Insufficient balance"
        );

        emit Deposit(msg.sender, amount, currentRound);

        Vault.DepositReceipt memory depositReceipt =
            depositReceipts[msg.sender];

        // If we have an unprocessed pending deposit from the previous rounds, we have to process it.
        uint128 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                currentRound,
                roundPricePerShare[depositReceipt.round],
                vaultParams.decimals
            );

        uint104 depositAmount = uint104(amount);
        // If we have a pending deposit in the current round, we add on to the pending deposit
        if (currentRound == depositReceipt.round) {
            // No deposits allowed until the next round
            require(!depositReceipt.processed, "Processed");

            uint256 newAmount = uint256(depositReceipt.amount).add(amount);
            ShareMath.assertUint104(newAmount);
            depositAmount = uint104(newAmount);
        } else {
            ShareMath.assertUint104(amount);
        }

        depositReceipts[msg.sender] = Vault.DepositReceipt({
            processed: false,
            round: currentRound,
            amount: depositAmount,
            unredeemedShares: unredeemedShares
        });

        vaultState.totalPending = uint128(
            uint256(vaultState.totalPending).add(amount)
        );
    }

    /**
     * @notice Redeems shares that are owed to the account
     * @param shares is the number of shares to redeem
     */
    function redeem(uint256 shares) external nonReentrant {
        require(shares > 0, "!shares");
        _redeem(shares, false);
    }

    /**
     * @notice Redeems the entire unredeemedShares balance that is owed to the account
     */
    function maxRedeem() external nonReentrant {
        _redeem(0, true);
    }

    /**
     * @notice Redeems shares that are owed to the account
     * @param shares is the number of shares to redeem, could be 0 when isMax=true
     * @param isMax is flag for when callers do a max redemption
     */
    function _redeem(uint256 shares, bool isMax) internal {
        ShareMath.assertUint104(shares);

        Vault.DepositReceipt memory depositReceipt =
            depositReceipts[msg.sender];

        // This handles the null case when depositReceipt.round = 0
        // Because we start with round = 1 at `initialize`
        uint16 currentRound = vaultState.round;
        require(depositReceipt.round < currentRound, "Round not closed");

        uint128 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                currentRound,
                roundPricePerShare[depositReceipt.round],
                vaultParams.decimals
            );

        shares = isMax ? unredeemedShares : shares;
        require(shares > 0, "!shares");
        require(shares <= unredeemedShares, "Exceeds available");

        // This zeroes out any pending amount from depositReceipt
        depositReceipts[msg.sender].amount = 0;
        depositReceipts[msg.sender].processed = true;
        depositReceipts[msg.sender].unredeemedShares = uint128(
            uint256(unredeemedShares).sub(shares)
        );

        emit Redeem(msg.sender, shares, depositReceipt.round);

        _transfer(address(this), msg.sender, shares);
    }

    /**
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param amount is the amount to withdraw
     */
    function withdrawInstantly(uint256 amount) external nonReentrant {
        Vault.DepositReceipt storage depositReceipt =
            depositReceipts[msg.sender];

        uint16 currentRound = vaultState.round;
        require(amount > 0, "!amount");
        require(!depositReceipt.processed, "Processed");
        require(depositReceipt.round == currentRound, "Invalid round");
        uint104 receiptAmount = depositReceipt.amount;
        require(receiptAmount >= amount, "Exceed amount");

        // Subtraction underflow checks already ensure it is smaller than uint104
        depositReceipt.amount = uint104(uint256(receiptAmount).sub(amount));

        emit InstantWithdraw(msg.sender, amount, currentRound);

        transferAsset(msg.sender, amount);
    }

    /**
     * @notice Initiates a withdrawal that can be processed once the round completes
     * @param shares is the number of shares to withdraw
     */
    function initiateWithdraw(uint128 shares) external nonReentrant {
        require(shares > 0, "!shares");

        // This caches the `round` variable used in shareBalances
        uint16 currentRound = vaultState.round;
        Vault.Withdrawal memory withdrawal = withdrawals[msg.sender];

        bool topup = withdrawal.initiated && withdrawal.round == currentRound;

        (uint256 heldByAccount, uint256 heldByVault) =
            shareBalances(msg.sender);

        uint256 vaultRemainder = heldByVault.sub(withdrawal.shares);
        uint256 totalShares = heldByAccount.add(vaultRemainder);

        require(shares <= totalShares, "Insufficient balance");

        emit InitiateWithdraw(msg.sender, shares, currentRound);

        if (topup) {
            uint256 increasedShares = uint256(withdrawal.shares).add(shares);
            require(increasedShares < type(uint128).max, "Overflow");
            withdrawals[msg.sender].shares = uint128(increasedShares);
        } else if (!withdrawal.initiated) {
            withdrawals[msg.sender].initiated = true;
            withdrawals[msg.sender].shares = shares;
            withdrawals[msg.sender].round = currentRound;
        } else {
            // If we have an old withdrawal, we revert
            // The user has to process the withdrawal
            revert("Existing withdraw");
        }

        vaultState.queuedWithdrawShares = uint128(
            uint256(vaultState.queuedWithdrawShares).add(shares)
        );

        // We need to debit the user's account when they are trying to withdraw
        // more than what's available in the vault, accounting for previous withdrawals
        if (shares > vaultRemainder) {
            uint256 debitShares = uint256(shares).sub(vaultRemainder);
            _transfer(msg.sender, address(this), debitShares);
        }
    }

    /**
     * @notice Completes a scheduled withdrawal from a past round. Uses finalized pps for the round
     */
    function completeWithdraw() external nonReentrant {
        Vault.Withdrawal memory withdrawal = withdrawals[msg.sender];

        require(withdrawal.initiated, "Not initiated");
        require(withdrawal.round < vaultState.round, "Round not closed");

        // We leave the round number as non-zero to save on gas for subsequent writes
        withdrawals[msg.sender].initiated = false;
        withdrawals[msg.sender].shares = 0;

        uint256 withdrawAmount =
            ShareMath.sharesToUnderlying(
                withdrawal.shares,
                roundPricePerShare[withdrawal.round],
                vaultParams.decimals
            );

        emit Withdraw(msg.sender, withdrawAmount, withdrawal.shares);

        require(withdrawAmount > 0, "!withdrawAmount");
        transferAsset(msg.sender, withdrawAmount);
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
        require(numRounds < 52, "numRounds >= 52");

        uint16 _round = vaultState.round;
        for (uint16 i = 0; i < numRounds; i++) {
            uint16 index = _round + i;
            require(index >= _round, "Overflow");
            require(roundPricePerShare[index] == 0, "Initialized"); // AVOID OVERWRITING ACTUAL VALUES
            roundPricePerShare[index] = PLACEHOLDER_UINT;
        }
    }

    /*
     * @notice Helper function that transfers management fees and performance fees from previous round.
     * @param currentLockedBalance is the balance we are about to lock for next round
     * @return vaultFee is the fee deducted
     */
    function _collectVaultFees(uint256 currentLockedBalance)
        internal
        returns (uint256 vaultFee)
    {
        uint256 prevLockedAmount = vaultState.lastLockedAmount;

        // Take performance fee and management fee ONLY if difference between
        // last week and this week's vault deposits, taking into account pending
        // deposits and withdrawals, is positive. If it is negative, last week's
        // option expired ITM past breakeven, and the vault took a loss so we
        // do not collect performance fee for last week
        if (
            currentLockedBalance.sub(vaultState.totalPending) > prevLockedAmount
        ) {
            uint256 performanceFeeInAsset =
                performanceFee > 0
                    ? currentLockedBalance
                        .sub(vaultState.totalPending)
                        .sub(prevLockedAmount)
                        .mul(performanceFee)
                        .div(100 * 10**6)
                    : 0;
            uint256 managementFeeInAsset =
                managementFee > 0
                    ? currentLockedBalance.mul(managementFee).div(100 * 10**6)
                    : 0;

            vaultFee = performanceFeeInAsset.add(managementFeeInAsset);
        }

        if (vaultFee > 0) {
            transferAsset(payable(feeRecipient), vaultFee);
            emit CollectVaultFees(performanceFee, vaultFee, vaultState.round);
        }
    }

    /**
     * @notice Helper function to make either an ETH transfer or ERC20 transfer
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(address payable recipient, uint256 amount) private {
        address asset = vaultParams.asset;
        if (asset == WETH) {
            IWETH(WETH).withdraw(amount);
            (bool success, ) = recipient.call{value: amount}("");
            require(success, "!success");
            return;
        }
        IERC20(asset).safeTransfer(recipient, amount);
    }

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Returns the underlying balance held on the vault for the account
     * @param account is the address to lookup balance for
     */
    function accountVaultBalance(address account)
        external
        view
        returns (uint256)
    {
        uint8 decimals = vaultParams.decimals;
        uint256 numShares = shares(account);
        uint256 pps =
            totalBalance().sub(vaultState.totalPending).mul(10**decimals).div(
                totalSupply()
            );
        return ShareMath.sharesToUnderlying(numShares, pps, decimals);
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

        if (depositReceipt.round < PLACEHOLDER_UINT) {
            return (balanceOf(account), 0);
        }

        uint128 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                vaultState.round,
                roundPricePerShare[depositReceipt.round],
                vaultParams.decimals
            );

        return (balanceOf(account), unredeemedShares);
    }

    /**
     * @notice The price of a unit of share denominated in the `collateral`
     */
    function pricePerShare() external view returns (uint256) {
        uint256 balance = totalBalance().sub(vaultState.totalPending);
        return
            (10**uint256(vaultParams.decimals)).mul(balance).div(totalSupply());
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

    function cap() external view returns (uint256) {
        return vaultParams.cap;
    }

    function nextOptionReadyAt() external view returns (uint256) {
        return optionState.nextOptionReadyAt;
    }

    function currentOption() external view returns (address) {
        return optionState.currentOption;
    }

    function nextOption() external view returns (address) {
        return optionState.nextOption;
    }

    function totalPending() external view returns (uint256) {
        return vaultState.totalPending;
    }

    /************************************************
     *  HELPERS
     ***********************************************/
}
