// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {GnosisAuction} from "../../../libraries/GnosisAuction.sol";
import {OptionsVaultStorage} from "../../../storage/OptionsVaultStorage.sol";
import {Vault} from "../../../libraries/Vault.sol";
import {VaultLifecycle} from "../../../libraries/VaultLifecycle.sol";
import {ShareMath} from "../../../libraries/ShareMath.sol";
import {IOtoken} from "../../../interfaces/GammaInterface.sol";
import {IWETH} from "../../../interfaces/IWETH.sol";
import {IGnosisAuction} from "../../../interfaces/IGnosisAuction.sol";
import {
    IStrikeSelection,
    IOptionsPremiumPricer
} from "../../../interfaces/IRibbon.sol";

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

    uint128 internal constant PLACEHOLDER_UINT = 1;

    // Number of weeks per year = 52.142857 weeks * 10**6 = 52142857
    // Dividing by weeks per year requires doing num.mul(10**6).div(WEEKS_PER_YEAR)
    uint256 private constant WEEKS_PER_YEAR = 52142857;

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

    event Deposit(address indexed account, uint256 amount, uint256 round);

    event InitiateWithdraw(address account, uint256 shares, uint256 round);

    event Redeem(address indexed account, uint256 share, uint256 round);

    event Withdraw(address account, uint256 amount, uint256 shares);

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
        managementFee = _managementFee.mul(10**6).div(WEEKS_PER_YEAR);
        vaultParams = _vaultParams;
        vaultState.lastLockedAmount = uint104(
            IERC20(vaultParams.asset).balanceOf(address(this))
        );

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
        require(newManagementFee < 100 * 10**6, "Invalid management fee");

        // We are dividing annualized management fee by num weeks in a year
        managementFee = newManagementFee.mul(10**6).div(WEEKS_PER_YEAR);
    }

    /**
     * @notice Sets the performance fee for the vault
     * @param newPerformanceFee is the performance fee (6 decimals). ex: 20 * 10 ** 6 = 20%
     */
    function setPerformanceFee(uint256 newPerformanceFee) external onlyOwner {
        require(newPerformanceFee < 100 * 10**6, "Invalid performance fee");
        performanceFee = newPerformanceFee;
    }

    /**
     * @notice Sets a new cap for deposits
     * @param newCap is the new cap for deposits
     */
    function setCap(uint104 newCap) external onlyOwner {
        require(newCap > 0, "!newCap");
        vaultParams.cap = newCap;
    }

    /************************************************
     *  DEPOSIT & WITHDRAWALS
     ***********************************************/

    /**
     * @notice Deposits ETH into the contract and mint vault shares. Reverts if the asset is not WETH.
     */
    function depositETH() external payable nonReentrant {
        require(vaultParams.asset == WETH, "!WETH");
        require(msg.value > 0, "!value");

        _depositFor(msg.value, msg.sender);

        IWETH(WETH).deposit{value: msg.value}();
    }

    /**
     * @notice Deposits the `asset` from msg.sender.
     * @param amount is the amount of `asset` to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "!amount");

        _depositFor(amount, msg.sender);

        IERC20(vaultParams.asset).safeTransferFrom(
            msg.sender,
            address(this),
            amount
        );
    }

    /**
     * @notice Deposits the `asset` from msg.sender added to `creditor`'s deposit.
     * @notice Used for vault -> vault deposits on the user's behalf
     * @param amount is the amount of `asset` to deposit
     * @param creditor is the address that can claim/withdraw deposited amount
     */
    function depositFor(uint256 amount, address creditor)
        external
        nonReentrant
    {
        require(amount > 0, "!amount");
        require(creditor != address(0));

        _depositFor(amount, creditor);

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

        require(totalWithDepositedAmount <= vaultParams.cap, "Exceed cap");
        require(
            totalWithDepositedAmount >= vaultParams.minimumSupply,
            "Insufficient balance"
        );

        emit Deposit(creditor, amount, currentRound);

        Vault.DepositReceipt memory depositReceipt = depositReceipts[creditor];

        // If we have an unprocessed pending deposit from the previous rounds, we have to process it.
        uint128 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                currentRound,
                roundPricePerShare[depositReceipt.round],
                vaultParams.decimals
            );

        uint256 depositAmount = uint104(amount);
        // If we have a pending deposit in the current round, we add on to the pending deposit
        if (currentRound == depositReceipt.round) {
            uint256 newAmount = uint256(depositReceipt.amount).add(amount);
            depositAmount = newAmount;
        }

        ShareMath.assertUint104(depositAmount);

        depositReceipts[creditor] = Vault.DepositReceipt({
            round: uint16(currentRound),
            amount: uint104(depositAmount),
            unredeemedShares: unredeemedShares
        });

        vaultState.totalPending = uint128(
            uint256(vaultState.totalPending).add(amount)
        );
    }

    /**
     * @notice Initiates a withdrawal that can be processed once the round completes
     * @param shares is the number of shares to withdraw
     */
    function initiateWithdraw(uint128 shares) external nonReentrant {
        require(shares > 0, "!shares");

        // We do a max redeem before initiating a withdrawal
        // But we check if they must first have unredeemed shares
        if (
            depositReceipts[msg.sender].amount > 0 ||
            depositReceipts[msg.sender].unredeemedShares > 0
        ) {
            _redeem(0, true);
        }

        // This caches the `round` variable used in shareBalances
        uint256 currentRound = vaultState.round;
        Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];

        bool topup = withdrawal.round == currentRound;

        emit InitiateWithdraw(msg.sender, shares, currentRound);

        uint256 withdrawalShares = uint256(withdrawal.shares);

        if (topup) {
            uint256 increasedShares = withdrawalShares.add(shares);
            ShareMath.assertUint128(increasedShares);
            withdrawals[msg.sender].shares = uint128(increasedShares);
        } else if (withdrawalShares == 0) {
            withdrawals[msg.sender].shares = shares;
            withdrawals[msg.sender].round = uint16(currentRound);
        } else {
            // If we have an old withdrawal, we revert
            // The user has to process the withdrawal
            revert("Existing withdraw");
        }

        vaultState.queuedWithdrawShares = uint128(
            uint256(vaultState.queuedWithdrawShares).add(shares)
        );

        _transfer(msg.sender, address(this), shares);
    }

    /**
     * @notice Completes a scheduled withdrawal from a past round. Uses finalized pps for the round
     */
    function completeWithdraw() external nonReentrant {
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
            ShareMath.sharesToUnderlying(
                withdrawalShares,
                roundPricePerShare[uint16(withdrawalRound)],
                vaultParams.decimals
            );

        emit Withdraw(msg.sender, withdrawAmount, withdrawalShares);

        _burn(address(this), withdrawalShares);

        require(withdrawAmount > 0, "!withdrawAmount");
        transferAsset(msg.sender, withdrawAmount);
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

        Vault.DepositReceipt storage depositReceipt =
            depositReceipts[msg.sender];

        // This handles the null case when depositReceipt.round = 0
        // Because we start with round = 1 at `initialize`
        uint256 currentRound = vaultState.round;
        uint256 receiptRound = depositReceipt.round;

        uint256 unredeemedShares =
            depositReceipt.getSharesFromReceipt(
                currentRound,
                roundPricePerShare[uint16(receiptRound)],
                vaultParams.decimals
            );

        shares = isMax ? unredeemedShares : shares;
        require(shares > 0, "!shares");
        require(shares <= unredeemedShares, "Exceeds available");

        // If we have a depositReceipt on the same round, BUT we have some unredeemed shares
        // we debit from the unredeemedShares, but leave the amount field intact
        // If the round has past, with no new deposits, we just zero it out for new deposits.
        depositReceipts[msg.sender].amount = receiptRound < currentRound
            ? 0
            : depositReceipt.amount;

        depositReceipts[msg.sender].unredeemedShares = uint128(
            unredeemedShares.sub(shares)
        );

        emit Redeem(msg.sender, shares, receiptRound);

        _transfer(address(this), msg.sender, shares);
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
     * @notice Helper function that performs most administrative tasks
     * such as setting next option, minting new shares, getting vault fees, etc.
     * @return newOption is the new option address
     * @return lockedBalance is the new balance used to calculate next option purchase size or collateral size
     */
    function _rollToNextOption() internal returns (address, uint256) {
        require(block.timestamp >= optionState.nextOptionReadyAt, "!ready");

        address newOption = optionState.nextOption;
        require(newOption != address(0), "!nextOption");

        (uint256 lockedBalance, uint256 newPricePerShare, uint256 mintShares) =
            VaultLifecycle.rollover(
                totalSupply(),
                vaultParams.asset,
                vaultParams.decimals,
                vaultParams.initialSharePrice,
                uint256(vaultState.totalPending),
                vaultState.queuedWithdrawShares
            );

        optionState.currentOption = newOption;
        optionState.nextOption = address(0);

        // Finalize the pricePerShare at the end of the round
        uint16 currentRound = vaultState.round;
        roundPricePerShare[currentRound] = newPricePerShare;

        // Take management / performance fee from previous round and deduct
        lockedBalance = lockedBalance.sub(_collectVaultFees(lockedBalance));

        vaultState.totalPending = 0;
        vaultState.round = currentRound + 1;

        _mint(address(this), mintShares);

        return (newOption, lockedBalance);
    }

    /*
     * @notice Helper function that transfers management fees and performance fees from previous round.
     * @param currentLockedBalance is the balance we are about to lock for next round
     * @return vaultFee is the fee deducted
     */
    function _collectVaultFees(uint256 currentLockedBalance)
        internal
        returns (uint256)
    {
        (uint256 performanceFeeInAsset, , uint256 vaultFee) =
            VaultLifecycle.getVaultFees(
                vaultState,
                currentLockedBalance,
                performanceFee,
                managementFee
            );

        if (vaultFee > 0) {
            transferAsset(payable(feeRecipient), vaultFee);
            emit CollectVaultFees(
                performanceFeeInAsset,
                vaultFee,
                vaultState.round
            );
        }

        return vaultFee;
    }

    /**
     * @notice Helper function to make either an ETH transfer or ERC20 transfer
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(address payable recipient, uint256 amount) internal {
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
