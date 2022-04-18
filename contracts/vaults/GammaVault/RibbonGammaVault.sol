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

import {GnosisAuction} from "../../libraries/GnosisAuction.sol";
import {
    RibbonGammaVaultStorage
} from "../../storage/RibbonGammaVaultStorage.sol";
import {Vault} from "../../libraries/Vault.sol";
import {VaultLifecycle} from "../../libraries/VaultLifecycle.sol";
import {VaultLifecycleGamma} from "../../libraries/VaultLifecycleGamma.sol";
import {UniswapRouter} from "../../libraries/UniswapRouter.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";
import {ILiquidityGauge} from "../../interfaces/ILiquidityGauge.sol";
import {IWETH} from "../../interfaces/IWETH.sol";
import {IERC20Detailed} from "../../interfaces/IERC20Detailed.sol";
import {IController, IOracle} from "../../interfaces/PowerTokenInterface.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in RibbonGammaVaultStorage.
 * RibbonGammaVault should not inherit from any other contract aside from RibbonVault, RibbonGammaVaultStorage
 */
contract RibbonGammaVault is
    ReentrancyGuardUpgradeable,
    OwnableUpgradeable,
    ERC20Upgradeable,
    RibbonGammaVaultStorage
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

    /// @notice 7 day period between each options sale.
    uint256 public constant PERIOD = 7 days;

    /// @notice The collateral ratio targeted by the vault (200%)
    uint256 public constant COLLATERAL_RATIO = 2e18;

    // Number of weeks per year = 52.142857 weeks * FEE_MULTIPLIER = 52142857
    // Dividing by weeks per year requires doing num.mul(FEE_MULTIPLIER).div(WEEKS_PER_YEAR)
    uint256 private constant WEEKS_PER_YEAR = 52142857;

    // CONTROLLER is the controller contract for interacting with Squeeth
    // https://github.com/opynfinance/squeeth-monorepo/blob/main/packages/hardhat/contracts/core/Controller.sol
    address public immutable CONTROLLER;

    // oSQTH token
    // https://github.com/opynfinance/squeeth-monorepo/blob/main/packages/hardhat/contracts/core/WPowerPerp.sol
    address public immutable SQTH;

    // Squeeth Oracle
    address public immutable ORACLE;

    // Squeeth short position vault ID
    uint256 public immutable VAULT_ID;

    // UNISWAP_ROUTER is the contract address of Uniswap V3 Router which handles swaps
    // https://github.com/Uniswap/v3-periphery/blob/main/contracts/interfaces/ISwapRouter.sol
    address public immutable UNISWAP_ROUTER;

    // UNISWAP_FACTORY is the contract address of Uniswap V3 Factory which stores pool information
    // https://github.com/Uniswap/v3-core/blob/main/contracts/interfaces/IUniswapV3Factory.sol
    address public immutable UNISWAP_FACTORY;

    // USDC/WETH Uniswap V3 Pool
    address public immutable USDC_WETH_POOL;

    // oSQTH/WETH Uniswap V3 Pool
    address public immutable SQTH_WETH_POOL;

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

    event CollectVaultFees(
        uint256 performanceFee,
        uint256 vaultFee,
        uint256 round,
        address indexed feeRecipient
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

    event InstantWithdraw(
        address indexed account,
        uint256 amount,
        uint256 round
    );

    /************************************************
     *  STRUCTS
     ***********************************************/

    /**
     * @notice Initialization parameters for the vault.
     * @param _owner is the owner of the vault with critical permissions
     * @param _feeRecipient is the address to recieve vault performance and management fees
     * @param _managementFee is the management fee pct.
     * @param _performanceFee is the perfomance fee pct.
     * @param _tokenName is the name of the token
     * @param _tokenSymbol is the symbol of the token
     * @param _ratioThreshold is the collateral ratio threshold at which the vault is eligible for a rebalancing
     * @param _optionAllocation is the multiplier on the amount to allocate towards the long strangle
     * @param _usdcWethSwapPath is the USDC -> WETH swap path
     * @param _wethUsdcSwapPath is the WETH -> USDC swap path
     */
    struct InitParams {
        address _owner;
        address _keeper;
        address _feeRecipient;
        uint256 _managementFee;
        uint256 _performanceFee;
        string _tokenName;
        string _tokenSymbol;
        uint256 _ratioThreshold;
        uint256 _optionAllocation;
        bytes _usdcWethSwapPath;
        bytes _wethUsdcSwapPath;
    }

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     * @param _squeethController is the contract address for Squeeth actions
     * @param _oracle is the Oracle contract used by the Squeeth controller
     * @param _uniswapRouter is the contract address for Uniswap V3 router which handles swaps
     * @param _uniswapFactory is the contract address for Uniswap V3 factory
     * @param _usdcWethPool is the USDC/WETH Uniswap V3 pool
     * @param _sqthWethPool is the oSQTH/WETH Uniswap V3 pool
     */
    constructor(
        address _weth,
        address _usdc,
        address _squeethController,
        address _oracle,
        address _uniswapRouter,
        address _uniswapFactory,
        address _usdcWethPool,
        address _sqthWethPool
    ) {
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");
        require(_squeethController != address(0), "!_squeethController");
        require(_oracle != address(0), "!_oracle");
        require(_uniswapRouter != address(0), "!_uniswapRouter");
        require(_uniswapFactory != address(0), "!_uniswapFactory");
        require(_usdcWethPool != address(0), "!_usdcWethPool");
        require(_sqthWethPool != address(0), "!_sqthWethPool");

        USDC = _usdc;
        WETH = _weth;

        CONTROLLER = _squeethController;
        address _sqth = address(IController(_squeethController).wPowerPerp());
        SQTH = _sqth;
        ORACLE = _oracle;
        // Creates a vault for this contract and saves the vault ID
        VAULT_ID = IController(_squeethController).mintWPowerPerpAmount(
            0,
            0,
            0
        );

        require(
            UniswapRouter.checkPool(
                _usdc,
                _weth,
                _usdcWethPool,
                _uniswapFactory
            ),
            "Invalid _usdcWethPool"
        );
        require(
            UniswapRouter.checkPool(
                _sqth,
                _weth,
                _sqthWethPool,
                _uniswapFactory
            ),
            "Invalid _sqthWethPool"
        );

        UNISWAP_ROUTER = _uniswapRouter;
        UNISWAP_FACTORY = _uniswapFactory;
        USDC_WETH_POOL = _usdcWethPool;
        SQTH_WETH_POOL = _sqthWethPool;
    }

    /**
     * @notice Initializes the RibbonGammaVault contract with storage variables.
     * @param _initParams is the struct with vault initialization parameters
     * @param _vaultParams is the struct with vault general data
     */
    function initialize(
        InitParams calldata _initParams,
        Vault.VaultParams memory _vaultParams
    ) external initializer {
        _vaultParams.isPut = false;
        _vaultParams.decimals = IERC20Detailed(USDC).decimals();
        _vaultParams.asset = USDC;
        _vaultParams.underlying = WETH;

        VaultLifecycle.verifyInitializerParams(
            _initParams._owner,
            _initParams._keeper,
            _initParams._feeRecipient,
            _initParams._performanceFee,
            _initParams._managementFee,
            _initParams._tokenName,
            _initParams._tokenSymbol,
            _vaultParams
        );

        __ReentrancyGuard_init();
        __ERC20_init(_initParams._tokenName, _initParams._tokenSymbol);
        __Ownable_init();
        transferOwnership(_initParams._owner);

        keeper = _initParams._keeper;

        feeRecipient = _initParams._feeRecipient;
        performanceFee = _initParams._performanceFee;
        managementFee = _initParams
            ._managementFee
            .mul(Vault.FEE_MULTIPLIER)
            .div(WEEKS_PER_YEAR);
        vaultParams = _vaultParams;

        uint256 assetBalance =
            IERC20(vaultParams.asset).balanceOf(address(this));
        ShareMath.assertUint104(assetBalance);
        vaultState.lastLockedAmount = uint104(assetBalance);

        vaultState.round = 1;

        require(
            _initParams._ratioThreshold != 0 &&
                _initParams._ratioThreshold <
                VaultLifecycleGamma.COLLATERAL_UNITS,
            "!_ratioThreshold"
        );
        require(
            UniswapRouter.checkPath(
                _initParams._usdcWethSwapPath,
                USDC,
                WETH,
                UNISWAP_FACTORY
            ),
            "!_usdcWethSwapPath"
        );
        require(
            UniswapRouter.checkPath(
                _initParams._wethUsdcSwapPath,
                WETH,
                USDC,
                UNISWAP_FACTORY
            ),
            "!_wethUsdcSwapPath"
        );

        ratioThreshold = _initParams._ratioThreshold;
        optionAllocation = _initParams._optionAllocation;
        usdcWethSwapPath = _initParams._usdcWethSwapPath;
        wethUsdcSwapPath = _initParams._wethUsdcSwapPath;
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

        // We are dividing annualized management fee by num weeks in a year
        uint256 tmpManagementFee =
            newManagementFee.mul(Vault.FEE_MULTIPLIER).div(WEEKS_PER_YEAR);

        emit ManagementFeeSet(managementFee, newManagementFee);

        managementFee = tmpManagementFee;
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
     * @notice Sets the new liquidityGauge contract for this vault
     * @param newLiquidityGauge is the address of the new liquidityGauge contract
     */
    function setLiquidityGauge(address newLiquidityGauge) external onlyOwner {
        liquidityGauge = newLiquidityGauge;
    }

    /**
     * @notice Sets the new optionsPurchaseQueue contract for this vault
     * @param newOptionsPurchaseQueue is the address of the new optionsPurchaseQueue contract
     */
    function setOptionsPurchaseQueue(address newOptionsPurchaseQueue)
        external
        onlyOwner
    {
        optionsPurchaseQueue = newOptionsPurchaseQueue;
    }

    /**
     * @notice Sets the new ratioThreshold value for this vault
     * @param newRatioThreshold is the new ratioThreshold
     */
    function setRatioThreshold(uint256 newRatioThreshold) external onlyOwner {
        ratioThreshold = newRatioThreshold;
    }

    /**
     * @notice Sets the new optionAllocation value for this vault
     * @param newOptionAllocation is the new optionAllocation
     */
    function setOptionAllocation(uint256 newOptionAllocation)
        external
        onlyOwner
    {
        optionAllocation = newOptionAllocation;
    }

    /**
     * @notice Sets the new USDC -> WETH swap path for this vault
     * @param newUsdcWethSwapPath is the new usdcWethSwapPath
     */
    function setUsdcWethSwapPath(bytes calldata newUsdcWethSwapPath)
        external
        onlyOwner
    {
        usdcWethSwapPath = newUsdcWethSwapPath;
    }

    /**
     * @notice Sets the new WETH -> USDC swap path for this vault
     * @param newWethUsdcSwapPath is the new wethUsdcSwapPath
     */
    function setWethUsdcSwapPath(bytes calldata newWethUsdcSwapPath)
        external
        onlyOwner
    {
        wethUsdcSwapPath = newWethUsdcSwapPath;
    }

    /************************************************
     *  DEPOSIT & WITHDRAWALS
     ***********************************************/

    /**
     * @notice Deposits the `asset` from msg.sender.
     * @param amount is the amount of `asset` to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        require(amount > 0, "!amount");

        _depositFor(amount, msg.sender);

        // An approve() by the msg.sender is required beforehand
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
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

        // An approve() by the msg.sender is required beforehand
        IERC20(USDC).safeTransferFrom(msg.sender, address(this), amount);
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
        if (
            depositReceipts[msg.sender].amount > 0 ||
            depositReceipts[msg.sender].unredeemedShares > 0
        ) {
            _redeem(0, true);
        }

        // This caches the `round` variable used in shareBalances
        uint256 currentRound = vaultState.round;
        Vault.Withdrawal storage withdrawal = withdrawals[msg.sender];

        bool withdrawalIsSameRound = withdrawal.round == currentRound;

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

        ShareMath.assertUint128(withdrawalShares);
        withdrawals[msg.sender].shares = uint128(withdrawalShares);

        uint256 newQueuedWithdrawShares =
            uint256(vaultState.queuedWithdrawShares).add(numShares);
        ShareMath.assertUint128(newQueuedWithdrawShares);
        vaultState.queuedWithdrawShares = uint128(newQueuedWithdrawShares);

        _transfer(msg.sender, address(this), numShares);
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
            ShareMath.sharesToAsset(
                withdrawalShares,
                roundPricePerShare[withdrawalRound],
                vaultParams.decimals
            );

        emit Withdraw(msg.sender, withdrawAmount, withdrawalShares);

        _burn(address(this), withdrawalShares);

        require(withdrawAmount > 0, "!withdrawAmount");
        IERC20(USDC).safeTransfer(msg.sender, withdrawAmount);

        lastQueuedWithdrawAmount = uint128(
            uint256(lastQueuedWithdrawAmount).sub(withdrawAmount)
        );
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

        // Subtraction underflow checks already ensure it is smaller than uint104
        depositReceipt.amount = uint104(receiptAmount.sub(amount));
        vaultState.totalPending = uint128(
            uint256(vaultState.totalPending).sub(amount)
        );

        emit InstantWithdraw(msg.sender, amount, currentRound);

        IERC20(USDC).safeTransfer(msg.sender, amount);
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
     * @notice Stakes a users vault shares
     * @param numShares is the number of shares to stake
     */
    function stake(uint256 numShares) external nonReentrant {
        address _liquidityGauge = liquidityGauge;
        require(_liquidityGauge != address(0)); // Removed revert msgs due to contract size limit
        require(numShares > 0);
        uint256 heldByAccount = balanceOf(msg.sender);
        if (heldByAccount < numShares) {
            _redeem(numShares.sub(heldByAccount), false);
        }
        _transfer(msg.sender, address(this), numShares);
        _approve(address(this), _liquidityGauge, numShares);
        ILiquidityGauge(_liquidityGauge).deposit(numShares, msg.sender, false);
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Mints vault shares for new depositors
     */
    function rollToNextRound() external onlyKeeper nonReentrant {
        vaultState.lastLockedAmount = uint104(vaultState.lockedAmount);
        vaultState.lockedAmount = 0;

        address recipient = feeRecipient;
        uint256 lockedBalance;
        uint256 queuedWithdrawAmount;
        uint256 mintShares;
        uint256 performanceFeeInAsset;
        uint256 totalVaultFee;
        {
            uint256 newPricePerShare;
            (
                lockedBalance,
                queuedWithdrawAmount,
                newPricePerShare,
                mintShares,
                performanceFeeInAsset,
                totalVaultFee
            ) = VaultLifecycle.rollover(
                vaultState,
                VaultLifecycle.RolloverParams(
                    vaultParams.decimals,
                    totalBalance(),
                    totalSupply(),
                    lastQueuedWithdrawAmount,
                    performanceFee,
                    managementFee
                )
            );

            uint256 currentRound = vaultState.round;
            roundPricePerShare[currentRound] = newPricePerShare;

            emit CollectVaultFees(
                performanceFeeInAsset,
                totalVaultFee,
                currentRound,
                recipient
            );

            pendingDeposits = vaultState.totalPending;

            vaultState.totalPending = 0;
            vaultState.round = uint16(currentRound + 1);
        }

        _mint(address(this), mintShares);

        if (totalVaultFee > 0) {
            IERC20(USDC).safeTransfer(recipient, totalVaultFee);
        }

        lastQueuedWithdrawAmount = queuedWithdrawAmount;

        ShareMath.assertUint104(lockedBalance);
        vaultState.lockedAmount = uint104(lockedBalance);

        newRoundInProgress = true;
    }

    /**
     * @notice Swaps pending USDC deposits into WETH
     * @param amountIn Amount of USDC to swap into WETH
     * @param minAmountOut Minimum amount of WETH to receive
     * @return amountOut Amount of WETH received from the swap
     */
    function swapTotalPending(uint256 amountIn, uint256 minAmountOut)
        external
        onlyKeeper
        nonReentrant
        returns (uint256 amountOut)
    {
        require(newRoundInProgress, "!newRoundInProgress");

        uint256 _pendingDeposits = pendingDeposits;
        if (amountIn > _pendingDeposits) amountIn = _pendingDeposits;

        amountOut = VaultLifecycleGamma.swapTotalPending(
            USDC,
            UNISWAP_ROUTER,
            usdcWethSwapPath,
            amountIn,
            minAmountOut
        );

        _pendingDeposits = _pendingDeposits.sub(amountIn);
        ShareMath.assertUint128(_pendingDeposits);

        pendingDeposits = uint128(_pendingDeposits);
    }

    /**
     * @notice Deposit WETH into the squeeth vault as collateral to mint SQTH
     * @param wethAmount Amount of WETH to deposit
     * @param minAmountOut Minimum amount of WETH to receive from swapping minted SQTH to WETH
     */
    function depositTotalPending(uint256 wethAmount, uint256 minAmountOut)
        external
        onlyKeeper
        nonReentrant
    {
        require(newRoundInProgress, "!newRoundInProgress");
        require(wethAmount > 0, "!wethAmount");
        require(minAmountOut > 0, "!minAmountOut");

        uint256 wethBalance = IERC20(WETH).balanceOf(address(this));
        if (wethAmount > wethBalance) wethAmount = wethBalance;

        uint256 wethUsdcPrice =
            VaultLifecycleGamma.getWethPrice(
                ORACLE,
                USDC_WETH_POOL,
                WETH,
                USDC
            );
        uint256 sqthAmount =
            VaultLifecycleGamma.getSqthMintAmount(
                CONTROLLER,
                wethUsdcPrice,
                COLLATERAL_RATIO,
                wethAmount
            );

        // Deposit ETH collateral and mint oSQTH
        IWETH(WETH).withdraw(wethAmount);
        IController(CONTROLLER).mintWPowerPerpAmount{value: wethAmount}(
            VAULT_ID,
            sqthAmount,
            0
        );

        // Swap received SQTH to WETH
        uint256 amountOut =
            UniswapRouter.swap(
                address(this),
                SQTH,
                sqthAmount,
                minAmountOut,
                UNISWAP_ROUTER,
                usdcWethSwapPath
            );

        // Deposit ETH as collateral
        IWETH(WETH).withdraw(amountOut);
        IController(CONTROLLER).deposit{value: amountOut}(VAULT_ID);
    }

    /**
     * @notice Deposit WETH from the squeeth vault and swaps to USDC to process queued withdrawals
     * @param wethAmount Amount of WETH to withdraw
     * @param minAmountOut Minimum amount of USDC to receive from swapping WETH to USDC
     */
    function withdrawQueuedShares(uint256 wethAmount, uint256 minAmountOut)
        external
        onlyKeeper
        nonReentrant
    {
        require(newRoundInProgress, "!newRoundInProgress");
        require(wethAmount > 0, "!wethAmount");
        require(minAmountOut > 0, "!minAmountOut");

        // Withdraw ETH from squeeth vault
        IController(CONTROLLER).withdraw(VAULT_ID, wethAmount);
        IWETH(WETH).deposit{value: wethAmount}();

        // Swap WETH to USDC
        uint256 amountOut =
            UniswapRouter.swap(
                address(this),
                WETH,
                wethAmount,
                minAmountOut,
                UNISWAP_ROUTER,
                usdcWethSwapPath
            );

        uint256 _lastQueuedWithdrawAmount = lastQueuedWithdrawAmount;
        lastQueuedWithdrawAmount = _lastQueuedWithdrawAmount > amountOut
            ? _lastQueuedWithdrawAmount.sub(amountOut)
            : 0;
    }

    /**
     * @notice Rebalances the squeeth position to target the collateral ratio
     *         reverts if the collateral ratio threshold isn't triggered
     */
    function rebalance() external onlyKeeper nonReentrant {
        require(!newRoundInProgress, "!newRoundInProgress");

        uint256 wethUsdcPrice =
            VaultLifecycleGamma.getWethPrice(
                ORACLE,
                USDC_WETH_POOL,
                WETH,
                USDC
            );
        (uint256 collateralAmount, uint256 debtValueInWeth) =
            VaultLifecycleGamma.getVaultPosition(
                CONTROLLER,
                VAULT_ID,
                wethUsdcPrice
            );

        uint256 collateralRatio =
            VaultLifecycleGamma.getCollateralRatio(
                collateralAmount,
                debtValueInWeth
            );
        uint256 _ratioThreshold = ratioThreshold;

        if (collateralRatio > COLLATERAL_RATIO.add(_ratioThreshold)) {
            uint256 wethAmount =
                VaultLifecycleGamma.getSqthMintAmount(
                    CONTROLLER,
                    wethUsdcPrice,
                    COLLATERAL_RATIO,
                    collateralAmount
                );

            // Withdraw ETH from squeeth vault
            IController(CONTROLLER).withdraw(VAULT_ID, wethAmount);
            IWETH(WETH).deposit{value: wethAmount}();
        } else if (collateralRatio < COLLATERAL_RATIO.sub(_ratioThreshold)) {
            uint256 sqthMintAmount =
                VaultLifecycleGamma.getSqthMintAmount(
                    CONTROLLER,
                    wethUsdcPrice,
                    COLLATERAL_RATIO,
                    collateralAmount
                );

            // Increase position debt
            IController(CONTROLLER).mintWPowerPerpAmount(
                VAULT_ID,
                sqthMintAmount,
                0
            );
        } else {
            revert("!_ratioThreshold");
        }
    }

    /**
     * @notice Called to `msg.sender` after executing a swap via IUniswapV3Pool#swap.
     * @dev In the implementation you must pay the pool tokens owed for the swap.
     *  The caller of this method must be checked to be a UniswapV3Pool deployed by the canonical UniswapV3Factory.
     *  amount0Delta and amount1Delta can both be 0 if no tokens were swapped.
     * @param amount0Delta The amount of token0 that was sent (negative) or must be received (positive) by the pool by
     *  the end of the swap. If positive, the callback must send that amount of token0 to the pool.
     * @param amount1Delta The amount of token1 that was sent (negative) or must be received (positive) by the pool by
     *  the end of the swap. If positive, the callback must send that amount of token1 to the pool.
     * @param data Any data passed through by the caller via the IUniswapV3PoolActions#swap call
     */
    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external {
        require(msg.sender == SQTH_WETH_POOL, "!SQTH_WETH_POOL"); // Only allow callbacks from the oSQTH/WETH pool
        require(amount0Delta > 0 || amount1Delta > 0); // Swaps entirely within 0-liquidity regions are not supported

        // Determine the amount that needs to be repaid as part of the flash swap
        uint256 amountToPay =
            amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);

        VaultLifecycleGamma.processCallback(
            CONTROLLER,
            WETH,
            SQTH,
            VAULT_ID,
            amountToPay,
            data
        );
    }

    /**
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

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Returns the asset balance held on the vault for the account
     * @param account is the address to lookup balance for
     * @return the amount of `asset` custodied by the vault for the user
     */
    function accountVaultBalance(address account)
        external
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
        uint256 wethUsdcPrice =
            VaultLifecycleGamma.getWethPrice(
                ORACLE,
                USDC_WETH_POOL,
                WETH,
                USDC
            );
        (uint256 collateralAmount, uint256 debtValueInWeth) =
            VaultLifecycleGamma.getVaultPosition(
                CONTROLLER,
                VAULT_ID,
                wethUsdcPrice
            );
        return
            IERC20(USDC)
                .balanceOf(address(this))
                .add(
                VaultLifecycleGamma.getWethUsdcValue(
                    wethUsdcPrice,
                    IERC20(WETH).balanceOf(address(this))
                )
            )
                .add(
                VaultLifecycleGamma.getVaultUsdcBalance(
                    wethUsdcPrice,
                    collateralAmount,
                    debtValueInWeth
                )
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

    function totalPending() external view returns (uint256) {
        return vaultState.totalPending;
    }
}
