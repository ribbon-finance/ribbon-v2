// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {DSMath} from "../vendor/DSMath.sol";
import {GammaProtocol} from "../protocols/GammaProtocol.sol";
import {GnosisAuction} from "../protocols/GnosisAuction.sol";
import {OptionsVaultStorage} from "../storage/OptionsVaultStorage.sol";
import {VaultDeposit} from "../libraries/VaultDeposit.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {IGnosisAuction} from "../interfaces/IGnosisAuction.sol";
import {
    IStrikeSelection,
    IOptionsPremiumPricer
} from "../interfaces/IRibbon.sol";

contract RibbonThetaVault is DSMath, OptionsVaultStorage {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    struct ReceiptTokenDetails {
        string tokenName;
        string tokenSymbol;
        uint8 tokenDecimals;
    }

    address public immutable WETH;
    address public immutable USDC;

    uint256 public constant delay = 1 hours;

    uint256 public constant period = 7 days;

    uint256 private constant PLACEHOLDER_UINT = 1;

    address private constant PLACEHOLDER_ADDR = address(1);

    // GAMMA_CONTROLLER is the top-level contract in Gamma protocol
    // which allows users to perform multiple actions on their vaults
    // and positions https://github.com/opynfinance/GammaProtocol/blob/master/contracts/Controller.sol
    address public immutable GAMMA_CONTROLLER;

    // oTokenFactory is the factory contract used to spawn otokens. Used to lookup otokens.
    address public immutable OTOKEN_FACTORY;

    // MARGIN_POOL is Gamma protocol's collateral pool.
    // Needed to approve collateral.safeTransferFrom for minting otokens.
    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/MarginPool.sol
    address public immutable MARGIN_POOL;

    // GNOSIS_EASY_AUCTION is Gnosis protocol's contract for initiating auctions
    // https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol
    address public immutable GNOSIS_EASY_AUCTION;

    /************************************************
     *  EVENTS
     ***********************************************/

    event ManagerChanged(address oldManager, address newManager);

    event Deposit(address indexed account, uint256 amount, uint16 round);

    event ScheduleWithdraw(address account, uint256 shares);

    event Withdraw(address indexed account, uint256 amount, uint256 share);

    event InstantWithdraw(
        address indexed account,
        uint256 amount,
        uint16 round
    );

    event Redeem(address indexed account, uint256 share, uint16 round);

    event OpenShort(
        address indexed options,
        uint256 depositAmount,
        address manager
    );

    event CloseShort(
        address indexed options,
        uint256 withdrawAmount,
        address manager
    );

    event NewOptionStrikeSelected(uint256 strikePrice, uint256 delta);

    event WithdrawalFeeSet(uint256 oldFee, uint256 newFee);

    event PremiumDiscountSet(
        uint256 premiumDiscount,
        uint256 newPremiumDiscount
    );

    event InitiateGnosisAuction(
        address auctioningToken,
        address biddingToken,
        uint256 auctionCounter,
        address manager
    );

    event CapSet(uint256 oldCap, uint256 newCap, address manager);

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
     * It's important to bake the _factory variable into the contract with the constructor
     * If we do it in the `initialize` function, users get to set the factory variable and
     * subsequently the adapter, which allows them to make a delegatecall, then selfdestruct the contract.
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
        require(_gnosisEasyAuction != address(0), "!_gnosisEasyAuction");
        require(_gammaController != address(0), "!_gammaController");
        require(_marginPool != address(0), "!_marginPool");

        WETH = _weth;
        USDC = _usdc;
        OTOKEN_FACTORY = _oTokenFactory;
        GAMMA_CONTROLLER = _gammaController;
        MARGIN_POOL = _marginPool;
        GNOSIS_EASY_AUCTION = _gnosisEasyAuction;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _owner is the owner of the contract who can set the manager
     * @param _feeRecipient is the recipient address for withdrawal fees.
     * @param _initCap is the initial vault's cap on deposits, the manager can increase this as necessary.
     * @param _receiptTokenDetails is a struct including the token name, symbol, and decimals
     * @param _minimumSupply is the minimum supply for the asset balance and the share supply.
     * @param _asset is the asset used for collateral and premiums
     * @param _isPut is the option type
     * @param _premiumDiscount is the premium discount of the sold options (thousandths place: 000 - 999)
     * @param _strikeSelection is the address of the contract handling weekly option strike selection
     * @param _optionsPremiumPricer is the address of the contract handling pricing option premiums using Black-Scholes
     */
    function initialize(
        address _owner,
        address _feeRecipient,
        uint256 _initCap,
        ReceiptTokenDetails calldata _receiptTokenDetails,
        uint256 _minimumSupply,
        address _asset,
        bool _isPut,
        uint256 _premiumDiscount,
        address _strikeSelection,
        address _optionsPremiumPricer
    ) external initializer {
        require(_asset != address(0), "!_asset");
        require(_owner != address(0), "!_owner");
        require(_feeRecipient != address(0), "!_feeRecipient");
        require(_initCap > 0, "!_initCap");
        require(
            bytes(_receiptTokenDetails.tokenName).length > 0,
            "!_tokenName"
        );
        require(
            bytes(_receiptTokenDetails.tokenSymbol).length > 0,
            "!_tokenSymbol"
        );
        require(_receiptTokenDetails.tokenDecimals > 0, "!_tokenDecimals");
        require(_minimumSupply > 0, "!_minimumSupply");
        require(_premiumDiscount > 0, "!_premiumDiscount");
        require(_strikeSelection != address(0), "!_strikeSelection");
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");

        __ReentrancyGuard_init();
        __ERC20_init(
            _receiptTokenDetails.tokenName,
            _receiptTokenDetails.tokenSymbol
        );
        __Ownable_init();
        transferOwnership(_owner);

        _decimals = _receiptTokenDetails.tokenDecimals;
        cap = _initCap;
        asset = _isPut ? USDC : _asset;
        underlying = _asset;
        minimumSupply = _minimumSupply;
        isPut = _isPut;

        // hardcode the initial withdrawal fee
        instantWithdrawalFee = 0 ether;
        feeRecipient = _feeRecipient;

        premiumDiscount = _premiumDiscount;
        optionsPremiumPricer = _optionsPremiumPricer;
        _totalPending = PLACEHOLDER_UINT; // Hardcode to 1 so no cold writes for depositors
        nextOption = PLACEHOLDER_ADDR; // Hardcode to 1 so no cold write for keeper

        strikeSelection = _strikeSelection;
        genesisTimestamp = uint32(block.timestamp);
        round = 1;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Sets the new manager of the vault.
     * @param newManager is the new manager of the vault
     */
    function setManager(address newManager) external onlyOwner {
        require(newManager != address(0), "!newManager");
        address oldManager = manager;
        manager = newManager;

        emit ManagerChanged(oldManager, newManager);
    }

    /**
     * @notice Sets the new fee recipient
     * @param newFeeRecipient is the address of the new fee recipient
     */
    function setFeeRecipient(address newFeeRecipient) external onlyOwner {
        require(newFeeRecipient != address(0), "!newFeeRecipient");
        feeRecipient = newFeeRecipient;
    }

    /**
     * @notice Sets the new discount on premiums for options we are selling
     * @param newPremiumDiscount is the premium discount
     */
    function setPremiumDiscount(uint256 newPremiumDiscount)
        external
        onlyManager
    {
        require(
            newPremiumDiscount > 0 && newPremiumDiscount < 300,
            "newPremiumDiscount is not between 0% - 30%!"
        );

        emit PremiumDiscountSet(premiumDiscount, newPremiumDiscount);

        premiumDiscount = newPremiumDiscount;
    }

    /**
     * @notice Sets a new cap for deposits
     * @param newCap is the new cap for deposits
     */
    function setCap(uint256 newCap) external onlyManager {
        uint256 oldCap = cap;
        cap = newCap;
        emit CapSet(oldCap, newCap, msg.sender);
    }

    /************************************************
     *  DEPOSIT & WITHDRAWALS
     ***********************************************/

    /**
     * @notice Deposits ETH into the contract and mint vault shares. Reverts if the underlying is not WETH.
     */
    function depositETH() external payable nonReentrant {
        require(asset == WETH, "!WETH");
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

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Mints the vault shares to the msg.sender
     * @param amount is the amount of `asset` deposited
     */
    function _deposit(uint256 amount) private {
        uint16 currentRound = round;
        uint256 totalWithDepositedAmount = totalBalance().add(amount);

        require(totalWithDepositedAmount < cap, "Exceed cap");
        require(
            totalWithDepositedAmount >= minimumSupply,
            "Insufficient balance"
        );

        emit Deposit(msg.sender, amount, currentRound);

        VaultDeposit.DepositReceipt memory depositReceipt =
            depositReceipts[msg.sender];

        // If we have an unprocessed pending deposit from the previous rounds, we have to process it.
        uint128 unredeemedShares = depositReceipt.unredeemedShares;
        if (
            depositReceipt.round > 0 &&
            depositReceipt.round < currentRound &&
            !depositReceipt.processed
        ) {
            unredeemedShares = _getSharesFromReceipt(depositReceipt);
        }

        // If we have a pending deposit in the current round, we add on to the pending deposit
        if (currentRound == depositReceipt.round) {
            // No deposits allowed until the next round
            require(!depositReceipt.processed, "Processed");

            uint256 newAmount = uint256(depositReceipt.amount).add(amount);
            require(newAmount < type(uint104).max, "Overflow");

            depositReceipts[msg.sender] = VaultDeposit.DepositReceipt({
                processed: false,
                round: currentRound,
                amount: uint104(newAmount),
                unredeemedShares: unredeemedShares
            });
        } else {
            require(amount < type(uint104).max, "Overflow");
            depositReceipts[msg.sender] = VaultDeposit.DepositReceipt({
                processed: false,
                round: currentRound,
                amount: uint104(amount),
                unredeemedShares: unredeemedShares
            });
        }

        _totalPending = _totalPending.add(amount);
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
        require(shares < type(uint104).max, "Overflow");

        VaultDeposit.DepositReceipt memory depositReceipt =
            depositReceipts[msg.sender];

        // This handles the null case when depositReceipt.round = 0
        // Because we start with round = 1 at `initialize`
        require(depositReceipt.round < round, "Round not closed");

        uint128 unredeemedShares = _getSharesFromReceipt(depositReceipt);

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
     * @notice Returns the shares unredeemed by the user given their DepositReceipt
     * @param depositReceipt is the user's deposit receipt
     * @return unredeemedShares is the user's virtual balance of shares that are owed
     */
    function _getSharesFromReceipt(
        VaultDeposit.DepositReceipt memory depositReceipt
    ) private view returns (uint128 unredeemedShares) {
        if (!depositReceipt.processed) {
            uint256 pps = roundPricePerShare[depositReceipt.round];

            // If this throws, it means that vault's roundPricePerShare[currentRound] has not been set yet
            // which should never happen.
            // Has to be larger than 1 because `1` is used in `initRoundPricePerShares` to prevent cold writes.
            require(pps > PLACEHOLDER_UINT, "Invalid pps");

            uint256 sharesFromRound =
                uint256(depositReceipt.amount).mul(10**uint256(_decimals)).div(
                    pps
                );
            require(sharesFromRound < type(uint104).max, "Overflow");

            uint256 unredeemedShares256 =
                uint256(depositReceipt.unredeemedShares).add(sharesFromRound);
            require(unredeemedShares256 < type(uint128).max, "Overflow");

            unredeemedShares = uint128(unredeemedShares256);
        } else {
            unredeemedShares = depositReceipt.unredeemedShares;
        }
    }

    /**
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param amount is the amount to withdraw
     */
    function withdrawInstantly(uint256 amount) external nonReentrant {
        VaultDeposit.DepositReceipt storage depositReceipt =
            depositReceipts[msg.sender];

        uint16 currentRound = round;
        require(amount > 0, "!amount");
        require(!depositReceipt.processed, "Processed");
        require(depositReceipt.round == currentRound, "Invalid round");
        uint104 receiptAmount = depositReceipt.amount;
        require(receiptAmount >= amount, "Exceed withdraw amount");

        // Subtraction underflow checks already ensure it is smaller than uint104
        depositReceipt.amount = uint104(uint256(receiptAmount).sub(amount));

        emit InstantWithdraw(msg.sender, amount, currentRound);

        transferAsset(msg.sender, amount);
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external onlyManager nonReentrant {
        address oldOption = currentOption;
        uint256 expiry;

        // uninitialized state
        if (oldOption <= PLACEHOLDER_ADDR) {
            expiry = getNextFriday(block.timestamp);
        } else {
            expiry = getNextFriday(IOtoken(oldOption).expiryTimestamp());
        }

        IStrikeSelection strikeSelection = IStrikeSelection(strikeSelection);

        (uint256 strikePrice, uint256 delta) =
            strikeOverride.lastStrikeOverride == round
                ? (
                    strikeOverride.overriddenStrikePrice,
                    strikeSelection.delta()
                )
                : IStrikeSelection(strikeSelection).getStrikePrice(
                    expiry,
                    isPut
                );

        require(strikePrice != 0, "Invalid strike selected!");

        address otokenAddress =
            GammaProtocol.getOrDeployOtoken(
                OTOKEN_FACTORY,
                underlying,
                USDC,
                asset,
                strikePrice,
                expiry,
                isPut
            );

        require(otokenAddress != address(0), "!otokenAddress");

        emit NewOptionStrikeSelected(strikePrice, delta);

        currentOtokenPremium = GnosisAuction.getOTokenPremium(
            otokenAddress,
            optionsPremiumPricer,
            premiumDiscount
        );

        require(currentOtokenPremium > 0, "!currentOtokenPremium");

        _setNextOption(otokenAddress);
        _closeShort(oldOption);
    }

    /**
     * @notice Sets the next option address and the timestamp at which the
     * admin can call `rollToNextOption` to open a short for the option.
     * @param oTokenAddress is the oToken address
     */
    function _setNextOption(address oTokenAddress) private {
        IOtoken otoken = IOtoken(oTokenAddress);
        require(otoken.isPut() == isPut, "Type mismatch");
        require(
            otoken.underlyingAsset() == underlying,
            "Wrong underlyingAsset"
        );
        require(otoken.collateralAsset() == asset, "Wrong collateralAsset");

        // we just assume all options use USDC as the strike
        require(otoken.strikeAsset() == USDC, "strikeAsset != USDC");

        uint256 readyAt = block.timestamp.add(delay);
        require(
            otoken.expiryTimestamp() >= readyAt,
            "Expiry cannot be before delay"
        );

        nextOption = oTokenAddress;
        nextOptionReadyAt = readyAt;
    }

    /**
     * @notice Closes the existing short position for the vault.
     */
    function _closeShort(address oldOption) private {
        currentOption = PLACEHOLDER_ADDR;
        lockedAmount = 0;

        if (oldOption > PLACEHOLDER_ADDR) {
            uint256 withdrawAmount =
                GammaProtocol.settleShort(GAMMA_CONTROLLER);
            emit CloseShort(oldOption, withdrawAmount, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external nonReentrant {
        require(block.timestamp >= nextOptionReadyAt, "Not ready");

        address newOption = nextOption;
        require(newOption > PLACEHOLDER_ADDR, "!nextOption");

        uint256 pendingAmount = totalPending();
        uint256 currentSupply = totalSupply();
        uint256 currentBalance = assetBalance();
        uint256 roundStartBalance = currentBalance.sub(pendingAmount);

        uint256 singleShare = 10**uint256(_decimals);

        uint256 currentPricePerShare =
            currentSupply > 0
                ? singleShare.mul(roundStartBalance).div(currentSupply)
                : singleShare;

        // After closing the short, if the options expire in-the-money
        // vault pricePerShare would go down because vault's asset balance decreased.
        // This ensures that the newly-minted shares do not take on the loss.
        uint256 mintShares =
            pendingAmount.mul(singleShare).div(currentPricePerShare);

        // Vault holds temporary custody of the newly minted vault shares
        _mint(address(this), mintShares);

        uint256 newSupply = currentSupply.add(mintShares);

        // TODO: We need to use the pps of the round they scheduled the withdrawal
        // not the pps of the new round. https://github.com/ribbon-finance/ribbon-v2/pull/10#discussion_r652174863
        uint256 queuedWithdrawAmount =
            newSupply > 0
                ? queuedWithdrawShares.mul(currentBalance).div(newSupply)
                : 0;

        uint256 balanceSansQueued = currentBalance.sub(queuedWithdrawAmount);

        _totalPending = PLACEHOLDER_UINT;
        currentOption = newOption;
        nextOption = PLACEHOLDER_ADDR;
        lockedAmount = balanceSansQueued;

        // Finalize the pricePerShare at the end of the round
        uint16 currentRound = round;
        roundPricePerShare[currentRound] = currentPricePerShare;
        round = currentRound + 1;

        emit OpenShort(newOption, balanceSansQueued, msg.sender);

        GammaProtocol.createShort(
            GAMMA_CONTROLLER,
            MARGIN_POOL,
            newOption,
            balanceSansQueued
        );

        startAuction();
    }

    /**
     * @notice Initiate the gnosis auction.
     */
    function startAuction() public onlyManager {
        GnosisAuction.AuctionDetails memory auctionDetails;

        require(currentOtokenPremium > 0, "!currentOtokenPremium");

        auctionDetails.oTokenAddress = currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = asset;
        auctionDetails.oTokenPremium = currentOtokenPremium;
        auctionDetails.manager = manager;
        auctionDetails.duration = 6 hours;

        GnosisAuction.startAuction(auctionDetails);
    }

    /**
     * @notice Burn the remaining oTokens left over from gnosis auction.
     */
    function burnRemainingOTokens() external onlyManager nonReentrant {
        uint256 numOTokensToBurn =
            IERC20(currentOption).balanceOf(address(this));
        require(numOTokensToBurn > 0, "No OTokens to burn!");
        uint256 assetBalanceBeforeBurn = assetBalance();
        GammaProtocol.burnOtokens(GAMMA_CONTROLLER, numOTokensToBurn);
        uint256 assetBalanceAfterBurn = assetBalance();
        lockedAmount = lockedAmount.sub(
            assetBalanceAfterBurn.sub(assetBalanceBeforeBurn)
        );
    }

    /**
     * @notice Optionality to set strike price manually
     * @param strikePrice is the strike price of the new oTokens (decimals = 8)
     */
    function setStrikePrice(uint128 strikePrice)
        external
        onlyManager
        nonReentrant
    {
        require(strikePrice > 0, "!strikePrice");
        require(strikePrice < type(uint128).max, "strike price too large!");
        strikeOverride.overriddenStrikePrice = strikePrice;
        strikeOverride.lastStrikeOverride = round;
    }

    /*
     * @notice Helper function that helps to save gas for writing values into the roundPricePerShare map.
     *         Writing `1` into the map makes subsequent writes warm, reducing the gas from 20k to 5k.
     *         Having 1 initialized beforehand will not be an issue as long as we round down share calculations to 0.
     * @param numRounds is the number of rounds to initialize in the map
     */
    function initRounds(uint256 numRounds) external nonReentrant {
        require(numRounds < 52, "numRounds >= 52");

        uint16 _round = round;
        for (uint16 i = 0; i < numRounds; i++) {
            uint16 index = _round + i;
            require(index >= _round, "SafeMath: addition overflow");
            require(roundPricePerShare[index] == 0, "Already initialized"); // AVOID OVERWRITING ACTUAL VALUES
            roundPricePerShare[index] = PLACEHOLDER_UINT;
        }
    }

    /**
     * @notice Helper function to make either an ETH transfer or ERC20 transfer
     * @param recipient is the receiving address
     * @param amount is the transfer amount
     */
    function transferAsset(address payable recipient, uint256 amount) private {
        if (asset == WETH) {
            IWETH(WETH).withdraw(amount);
            (bool success, ) = recipient.call{value: amount}("");
            require(success, "Transfer failed");
            return;
        }
        IERC20(asset).safeTransfer(recipient, amount);
    }

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Getter for returning the account's share balance including unredeemed shares
     * @param account is the account to lookup share balance for
     * @return the share balance
     */
    function shares(address account) external view returns (uint256) {
        VaultDeposit.DepositReceipt memory depositReceipt =
            depositReceipts[account];

        if (depositReceipt.round < PLACEHOLDER_UINT) {
            return balanceOf(account);
        }
        uint256 unredeemedShares = _getSharesFromReceipt(depositReceipt);
        return balanceOf(account).add(unredeemedShares);
    }

    /**
     * @notice Getter to get the total pending amount, ex the `1` used as a placeholder
     */
    function totalPending() public view returns (uint256) {
        return _totalPending.sub(PLACEHOLDER_UINT);
    }

    /**
     * @notice The price of a unit of share denominated in the `collateral`
     */
    function pricePerShare() external view returns (uint256) {
        uint256 balance = totalBalance().sub(totalPending());
        return (10**uint256(_decimals)).mul(balance).div(totalSupply());
    }

    /**
     * @notice Returns the expiry of the current option the vault is shorting
     */
    function currentOptionExpiry() external view returns (uint256) {
        address _currentOption = currentOption;
        if (_currentOption == address(0)) {
            return 0;
        }

        IOtoken oToken = IOtoken(_currentOption);
        return oToken.expiryTimestamp();
    }

    /**
     * @notice Returns the vault's total balance, including the amounts locked into a short position
     * @return total balance of the vault, including the amounts locked in third party protocols
     */
    function totalBalance() public view returns (uint256) {
        return lockedAmount.add(IERC20(asset).balanceOf(address(this)));
    }

    /**
     * @notice Returns the asset balance on the vault. This balance is freely withdrawable by users.
     */
    function assetBalance() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    /**
     * @notice Returns the token decimals
     */
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /************************************************
     *  HELPERS
     ***********************************************/

    /**
     * @notice Gets the next options expiry timestamp
     */
    function getNextFriday(uint256 currentExpiry)
        internal
        pure
        returns (uint256)
    {
        uint256 nextWeek = currentExpiry + 86400 * 7;
        uint256 dayOfWeek = ((nextWeek / 86400) + 4) % 7;

        uint256 friday;
        if (dayOfWeek > 5) {
            friday = nextWeek - 86400 * (dayOfWeek - 5);
        } else {
            friday = nextWeek + 86400 * (5 - dayOfWeek);
        }

        uint256 friday8am =
            (friday - (friday % (60 * 60 * 24))) + (8 * 60 * 60);
        return friday8am;
    }

    /************************************************
     *  MODIFIERS
     ***********************************************/

    /**
     * @notice Only allows manager to execute a function
     */
    modifier onlyManager {
        require(msg.sender == manager, "Only manager");
        _;
    }
}
