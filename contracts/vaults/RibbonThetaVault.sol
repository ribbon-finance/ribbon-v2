// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {GammaProtocol} from "../protocols/GammaProtocol.sol";
import {GnosisAuction} from "../protocols/GnosisAuction.sol";
import {OptionsVaultStorage} from "../storage/OptionsVaultStorage.sol";
import {Vault} from "../libraries/Vault.sol";
import {ShareMath} from "../libraries/ShareMath.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {IGnosisAuction} from "../interfaces/IGnosisAuction.sol";
import {
    IStrikeSelection,
    IOptionsPremiumPricer
} from "../interfaces/IRibbon.sol";

contract RibbonThetaVault is OptionsVaultStorage {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    struct ReceiptTokenDetails {
        string tokenName;
        string tokenSymbol;
    }

    address public immutable WETH;
    address public immutable USDC;

    uint256 public constant delay = 1 hours;

    uint256 public constant period = 7 days;

    uint128 private constant PLACEHOLDER_UINT = 1;

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

    event Deposit(address indexed account, uint256 amount, uint16 round);

    event InitiateWithdraw(address account, uint256 shares, uint16 round);

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
     */
    function initialize(
        address _owner,
        Vault.VaultParams calldata _vaultParams,
        Vault.ProtocolFee calldata _protocolFee,
        ReceiptTokenDetails calldata _receiptTokenDetails
    ) external initializer {
        __ReentrancyGuard_init();
        __ERC20_init(
            _receiptTokenDetails.tokenName,
            _receiptTokenDetails.tokenSymbol
        );
        __Ownable_init();
        transferOwnership(_owner);

        vaultParams = _vaultParams;
        protocolFee = _protocolFee;

        vaultState.round = 1;
        vaultState.totalPending = PLACEHOLDER_UINT; // Hardcode to 1 so no cold writes for depositors
        optionState.nextOption = PLACEHOLDER_ADDR; // Hardcode to 1 so no cold write for keeper
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
        protocolFee.recipient = newFeeRecipient;
    }

    /**
     * @notice Sets the new discount on premiums for options we are selling
     * @param newPremiumDiscount is the premium discount
     */
    function setPremiumDiscount(uint16 newPremiumDiscount) external onlyOwner {
        require(
            newPremiumDiscount > 0 && newPremiumDiscount < 300,
            "Invalid discount"
        );

        emit PremiumDiscountSet(vaultState.premiumDiscount, newPremiumDiscount);

        vaultState.premiumDiscount = newPremiumDiscount;
    }

    /**
     * @notice Sets a new cap for deposits
     * @param newCap is the new cap for deposits
     */
    function setCap(uint128 newCap) external onlyOwner {
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
            assertUint104(newAmount);
            depositAmount = uint104(newAmount);
        } else {
            assertUint104(amount);
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
        assertUint104(shares);

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

        require(!withdrawal.initiated, "Existing withdraw");

        (uint256 heldByAccount, uint256 heldByVault) =
            shareBalances(msg.sender);

        uint256 totalShares = heldByAccount.add(heldByVault);

        require(shares <= totalShares, "Insufficient balance");

        emit InitiateWithdraw(msg.sender, shares, currentRound);

        withdrawals[msg.sender].initiated = true;
        withdrawals[msg.sender].round = currentRound;
        withdrawals[msg.sender].shares = shares;

        vaultState.queuedWithdrawShares = uint128(
            uint256(vaultState.queuedWithdrawShares).add(shares)
        );

        if (shares > heldByVault) {
            uint256 debitShares = uint256(shares).sub(heldByVault);
            _transfer(msg.sender, address(this), debitShares);
        }
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external onlyOwner nonReentrant {
        address oldOption = optionState.currentOption;
        uint256 expiry;

        // uninitialized state
        if (oldOption <= PLACEHOLDER_ADDR) {
            expiry = GammaProtocol.getNextFriday(block.timestamp);
        } else {
            expiry = GammaProtocol.getNextFriday(
                IOtoken(oldOption).expiryTimestamp()
            );
        }

        IStrikeSelection selection =
            IStrikeSelection(vaultParams.strikeSelection);

        (uint256 strikePrice, uint256 delta) =
            vaultState.lastStrikeOverride == vaultState.round
                ? (overridenStrikePrice, selection.delta())
                : selection.getStrikePrice(expiry, vaultParams.isPut);

        require(strikePrice != 0, "!strikePrice");

        address otokenAddress =
            GammaProtocol.getOrDeployOtoken(
                OTOKEN_FACTORY,
                vaultParams.underlying,
                USDC,
                vaultParams.asset,
                strikePrice,
                expiry,
                vaultParams.isPut
            );

        require(otokenAddress != address(0), "!otokenAddress");

        emit NewOptionStrikeSelected(strikePrice, delta);

        vaultState.currentOtokenPremium = uint104(
            GnosisAuction.getOTokenPremium(
                otokenAddress,
                vaultParams.optionsPremiumPricer,
                vaultState.premiumDiscount
            )
        );

        require(vaultState.currentOtokenPremium > 0, "!currentOtokenPremium");

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
        require(otoken.isPut() == vaultParams.isPut, "Type mismatch");
        require(
            otoken.underlyingAsset() == vaultParams.underlying,
            "Wrong underlyingAsset"
        );
        require(
            otoken.collateralAsset() == vaultParams.asset,
            "Wrong collateralAsset"
        );

        // we just assume all options use USDC as the strike
        require(otoken.strikeAsset() == USDC, "strikeAsset != USDC");

        uint256 readyAt = block.timestamp.add(delay);
        require(otoken.expiryTimestamp() >= readyAt, "Expiry before delay");

        optionState.nextOption = oTokenAddress;
        optionState.nextOptionReadyAt = uint32(readyAt);
    }

    /**
     * @notice Closes the existing short position for the vault.
     */
    function _closeShort(address oldOption) private {
        optionState.currentOption = PLACEHOLDER_ADDR;
        vaultState.lockedAmount = 0;

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
        require(block.timestamp >= optionState.nextOptionReadyAt, "Not ready");

        address newOption = optionState.nextOption;
        require(newOption > PLACEHOLDER_ADDR, "!nextOption");

        uint256 pendingAmount = totalPending();
        uint256 currentSupply = totalSupply();
        uint256 currentBalance =
            IERC20(vaultParams.asset).balanceOf(address(this));
        uint256 roundStartBalance = currentBalance.sub(pendingAmount);

        uint256 singleShare = 10**uint256(vaultParams.decimals);

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
                ? uint256(vaultState.queuedWithdrawShares)
                    .mul(currentBalance)
                    .div(newSupply)
                : 0;

        uint256 balanceSansQueued = currentBalance.sub(queuedWithdrawAmount);

        vaultState.totalPending = PLACEHOLDER_UINT;
        optionState.currentOption = newOption;
        optionState.nextOption = PLACEHOLDER_ADDR;
        vaultState.lockedAmount = uint104(balanceSansQueued);

        // Finalize the pricePerShare at the end of the round
        uint16 currentRound = vaultState.round;
        roundPricePerShare[currentRound] = currentPricePerShare;
        vaultState.round = currentRound + 1;

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
    function startAuction() public onlyOwner {
        GnosisAuction.AuctionDetails memory auctionDetails;

        require(vaultState.currentOtokenPremium > 0, "!currentOtokenPremium");

        auctionDetails.oTokenAddress = optionState.currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = vaultParams.asset;
        auctionDetails.oTokenPremium = vaultState.currentOtokenPremium;
        auctionDetails.manager = owner();
        auctionDetails.duration = 6 hours;

        GnosisAuction.startAuction(auctionDetails);
    }

    /**
     * @notice Burn the remaining oTokens left over from gnosis auction.
     */
    function burnRemainingOTokens() external onlyOwner nonReentrant {
        uint256 numOTokensToBurn =
            IERC20(optionState.currentOption).balanceOf(address(this));
        require(numOTokensToBurn > 0, "!otokens");
        uint256 assetBalanceBeforeBurn =
            IERC20(vaultParams.asset).balanceOf(address(this));
        GammaProtocol.burnOtokens(GAMMA_CONTROLLER, numOTokensToBurn);
        uint256 assetBalanceAfterBurn =
            IERC20(vaultParams.asset).balanceOf(address(this));
        vaultState.lockedAmount = uint104(
            uint256(vaultState.lockedAmount).sub(
                assetBalanceAfterBurn.sub(assetBalanceBeforeBurn)
            )
        );
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
        assertUint128(strikePrice);
        overridenStrikePrice = strikePrice;
        vaultState.lastStrikeOverride = vaultState.round;
    }

    /*
     * @notice Helper function that helps to save gas for writing values into the roundPricePerShare map.
     *         Writing `1` into the map makes subsequent writes warm, reducing the gas from 20k to 5k.
     *         Having 1 initialized beforehand will not be an issue as long as we round down share calculations to 0.
     * @param numRounds is the number of rounds to initialize in the map
     */
    // function initRounds(uint256 numRounds) external nonReentrant {
    //     require(numRounds < 52, "numRounds >= 52");

    //     uint16 _round = round;
    //     for (uint16 i = 0; i < numRounds; i++) {
    //         uint16 index = _round + i;
    //         require(index >= _round, "Overflow");
    //         require(roundPricePerShare[index] == 0, "Initialized"); // AVOID OVERWRITING ACTUAL VALUES
    //         roundPricePerShare[index] = PLACEHOLDER_UINT;
    //     }
    // }

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
     * @notice Getter for returning the account's share balance including unredeemed shares
     * @param account is the account to lookup share balance for
     * @return the share balance
     */
    function shares(address account) external view returns (uint256) {
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
     * @notice Getter to get the total pending amount, ex the `1` used as a placeholder
     */
    function totalPending() public view returns (uint256) {
        return uint256(vaultState.totalPending).sub(PLACEHOLDER_UINT);
    }

    /**
     * @notice The price of a unit of share denominated in the `collateral`
     */
    function pricePerShare() external view returns (uint256) {
        uint256 balance = totalBalance().sub(totalPending());
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

    /************************************************
     *  HELPERS
     ***********************************************/

    function assertUint104(uint256 num) internal pure {
        require(num < type(uint104).max, ">U104");
    }

    function assertUint128(uint256 num) internal pure {
        require(num < type(uint104).max, ">U128");
    }
}
