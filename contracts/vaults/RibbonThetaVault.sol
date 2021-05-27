// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {DSMath} from "../lib/DSMath.sol";
import {GammaProtocol} from "../protocols/GammaProtocol.sol";
import {GnosisAuction} from "../protocols/GnosisAuction.sol";
import {OptionsVaultStorage} from "../storage/OptionsVaultStorage.sol";
import {IOtoken} from "../interfaces/GammaInterface.sol";
import {IWETH} from "../interfaces/IWETH.sol";
import {IStrikeSelection} from "../interfaces/IRibbon.sol";

contract RibbonThetaVault is
    DSMath,
    GammaProtocol,
    GnosisAuction,
    OptionsVaultStorage
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    address public immutable WETH;
    address public immutable USDC;

    // 90% locked in options protocol, 10% of the pool reserved for withdrawals
    uint256 public constant lockedRatio = 0.9 ether;

    uint256 public constant delay = 1 hours;

    uint256 public constant period = 7 days;

    /************************************************
     *  EVENTS
     ***********************************************/

    event ManagerChanged(address oldManager, address newManager);

    event Deposit(address indexed account, uint256 amount, uint256 share);

    event Withdraw(
        address indexed account,
        uint256 amount,
        uint256 share,
        uint256 fee
    );

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

    event WithdrawalFeeSet(uint256 oldFee, uint256 newFee);

    event CapSet(uint256 oldCap, uint256 newCap, address manager);

    event ScheduleWithdraw(address account, uint256 shares);

    event ScheduledWithdrawCompleted(address account, uint256 amount);

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
        address _marginPool
    ) GammaProtocol(_oTokenFactory, _gammaController, _marginPool) {
        require(_weth != address(0), "!_weth");
        require(_usdc != address(0), "!_usdc");

        WETH = _weth;
        USDC = _usdc;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _owner is the owner of the contract who can set the manager
     * @param _feeRecipient is the recipient address for withdrawal fees.
     * @param _initCap is the initial vault's cap on deposits, the manager can increase this as necessary.
     * @param _tokenName is the name of the vault share token
     * @param _tokenSymbol is the symbol of the vault share token
     * @param _tokenDecimals is the decimals for the vault shares. Must match the decimals for _asset.
     * @param _minimumSupply is the minimum supply for the asset balance and the share supply.
     * @param _asset is the asset used for collateral and premiums
     * @param _isPut is the option type
     */
    function initialize(
        address _owner,
        address _feeRecipient,
        uint256 _initCap,
        string calldata _tokenName,
        string calldata _tokenSymbol,
        uint8 _tokenDecimals,
        uint256 _minimumSupply,
        address _asset,
        bool _isPut
    ) external initializer {
        require(_asset != address(0), "!_asset");
        require(_owner != address(0), "!_owner");
        require(_feeRecipient != address(0), "!_feeRecipient");
        require(_initCap > 0, "!_initCap");
        require(bytes(_tokenName).length > 0, "!_tokenName");
        require(bytes(_tokenSymbol).length > 0, "!_tokenSymbol");
        require(_tokenDecimals > 0, "!_tokenDecimals");
        require(_minimumSupply > 0, "!_minimumSupply");

        __ReentrancyGuard_init();
        __ERC20_init(_tokenName, _tokenSymbol);
        __Ownable_init();
        transferOwnership(_owner);

        _decimals = _tokenDecimals;
        cap = _initCap;
        asset = _isPut ? USDC : _asset;
        underlying = _asset;
        minimumSupply = _minimumSupply;
        isPut = _isPut;

        // hardcode the initial withdrawal fee
        instantWithdrawalFee = 0.005 ether;
        feeRecipient = _feeRecipient;
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
     * @notice Sets the new withdrawal fee
     * @param newWithdrawalFee is the fee paid in tokens when withdrawing
     */
    function setWithdrawalFee(uint256 newWithdrawalFee) external onlyManager {
        require(newWithdrawalFee > 0, "withdrawalFee != 0");

        // cap max withdrawal fees to 30% of the withdrawal amount
        require(newWithdrawalFee < 0.3 ether, "withdrawalFee >= 30%");

        uint256 oldFee = instantWithdrawalFee;
        emit WithdrawalFeeSet(oldFee, newWithdrawalFee);

        instantWithdrawalFee = newWithdrawalFee;
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
        require(asset == WETH, "Not WETH");
        require(msg.value > 0, "No value");

        IWETH(WETH).deposit{value: msg.value}();
        _deposit(msg.value);
    }

    /**
     * @notice Deposits the `asset` into the contract and mint vault shares.
     * @param amount is the amount of `asset` to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        _deposit(amount);
    }

    /**
     * @notice Mints the vault shares to the msg.sender
     * @param amount is the amount of `asset` deposited
     */
    function _deposit(uint256 amount) private {
        uint256 totalWithDepositedAmount = totalBalance();
        require(totalWithDepositedAmount < cap, "Exceed cap");
        require(
            totalWithDepositedAmount >= minimumSupply,
            "Insufficient balance"
        );

        // amount needs to be subtracted from totalBalance because it has already been
        // added to it from either IWETH.deposit and IERC20.safeTransferFrom
        uint256 total = totalWithDepositedAmount.sub(amount);

        uint256 shareSupply = totalSupply();

        // Following the pool share calculation from Alpha Homora:
        // solhint-disable-next-line
        // https://github.com/AlphaFinanceLab/alphahomora/blob/340653c8ac1e9b4f23d5b81e61307bf7d02a26e8/contracts/5/Bank.sol#L104
        uint256 share =
            shareSupply == 0 ? amount : amount.mul(shareSupply).div(total);

        require(shareSupply.add(share) >= minimumSupply, "Insufficient supply");

        emit Deposit(msg.sender, amount, share);

        _mint(msg.sender, share);
    }

    /**
     * @notice Withdraws ETH from vault using vault shares
     * @param share is the number of vault shares to be burned
     */
    function withdrawETH(uint256 share) external nonReentrant {
        require(asset == WETH, "!WETH");
        uint256 withdrawAmount = _withdraw(share);

        IWETH(WETH).withdraw(withdrawAmount);
        (bool success, ) = msg.sender.call{value: withdrawAmount}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Withdraws WETH from vault using vault shares
     * @param share is the number of vault shares to be burned
     */
    function withdraw(uint256 share) external nonReentrant {
        uint256 withdrawAmount = _withdraw(share);
        IERC20(asset).safeTransfer(msg.sender, withdrawAmount);
    }

    /**
     * @notice Burns vault shares and checks if eligible for withdrawal
     * @param share is the number of vault shares to be burned
     */
    function _withdraw(uint256 share) private returns (uint256) {
        (uint256 amountAfterFee, uint256 feeAmount) =
            withdrawAmountWithShares(share);

        emit Withdraw(msg.sender, amountAfterFee, share, feeAmount);

        _burn(msg.sender, share);
        IERC20(asset).safeTransfer(feeRecipient, feeAmount);

        return amountAfterFee;
    }

    /**
     * @notice Lock's users shares for future withdraw and ensures that the new short excludes the scheduled amount.
     * @param shares is the number of shares to be withdrawn in the future.
     */
    function withdrawLater(uint256 shares) external nonReentrant {
        require(shares > 0, "!shares");
        require(
            scheduledWithdrawals[msg.sender] == 0,
            "Withdrawal already exists"
        );

        emit ScheduleWithdraw(msg.sender, shares);

        scheduledWithdrawals[msg.sender] = shares;
        queuedWithdrawShares = queuedWithdrawShares.add(shares);
        _transfer(msg.sender, address(this), shares);
    }

    /**
     * @notice Burns user's locked tokens and withdraws assets to msg.sender.
     */
    function completeScheduledWithdrawal() external nonReentrant {
        uint256 withdrawShares = scheduledWithdrawals[msg.sender];
        require(withdrawShares > 0, "Withdrawal not found");

        scheduledWithdrawals[msg.sender] = 0;
        queuedWithdrawShares = queuedWithdrawShares.sub(withdrawShares);

        (uint256 amountAfterFee, uint256 feeAmount) =
            withdrawAmountWithShares(withdrawShares);

        emit Withdraw(msg.sender, amountAfterFee, withdrawShares, feeAmount);
        emit ScheduledWithdrawCompleted(msg.sender, amountAfterFee);

        _burn(address(this), withdrawShares);
        IERC20(asset).safeTransfer(feeRecipient, feeAmount);
        if (asset == WETH) {
            IWETH(WETH).withdraw(amountAfterFee);
            (bool success, ) = msg.sender.call{value: amountAfterFee}("");
            require(success, "Transfer failed");
        } else {
            IERC20(asset).safeTransfer(msg.sender, amountAfterFee);
        }
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
        uint256 expiry = IOtoken(oldOption).expiryTimestamp() + 7 days;

        uint256 strikePrice =
            IStrikeSelection(strikeSelection).getStrikePrice();
        address otokenAddress =
            GammaProtocol._getOrDeployOtoken(
                underlying,
                USDC,
                asset,
                strikePrice,
                expiry,
                isPut
            );

        require(otokenAddress != address(0), "!otokenAddress");

        _setNextOption(otokenAddress);
        _closeShort(oldOption);
    }

    function closeShort() external nonReentrant {
        address oldOption = currentOption;
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
        currentOption = address(0);
        lockedAmount = 0;

        if (oldOption != address(0)) {
            IOtoken otoken = IOtoken(oldOption);
            require(
                block.timestamp > otoken.expiryTimestamp(),
                "Cannot close before expiry"
            );
            uint256 withdrawAmount = GammaProtocol._settleShort();
            emit CloseShort(oldOption, withdrawAmount, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external onlyManager nonReentrant {
        require(block.timestamp >= nextOptionReadyAt, "Not ready");

        address newOption = nextOption;
        require(newOption != address(0), "!nextOption");

        currentOption = newOption;
        nextOption = address(0);

        uint256 currentBalance = assetBalance();
        (uint256 queuedWithdrawAmount, , ) =
            _withdrawAmountWithShares(queuedWithdrawShares, currentBalance);
        uint256 freeBalance = currentBalance.sub(queuedWithdrawAmount);
        uint256 shortAmount = wmul(freeBalance, lockedRatio);
        lockedAmount = shortAmount;

        GammaProtocol._createShort(newOption, shortAmount);

        emit OpenShort(newOption, shortAmount, msg.sender);
    }

    /**
     * @notice Performs a swap of `currentOption` token to `asset` token with a counterparty
     */
    function sellOptions() external onlyManager {}

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Returns the expiry of the current option the vault is shorting
     */
    function currentOptionExpiry() external view returns (uint256) {
        address _currentOption = currentOption;
        if (_currentOption == address(0)) {
            return 0;
        }

        IOtoken oToken = IOtoken(currentOption);
        return oToken.expiryTimestamp();
    }

    /**
     * @notice Returns the amount withdrawable (in `asset` tokens) using the `share` amount
     * @param share is the number of shares burned to withdraw asset from the vault
     * @return amountAfterFee is the amount of asset tokens withdrawable from the vault
     * @return feeAmount is the fee amount (in asset tokens) sent to the feeRecipient
     */
    function withdrawAmountWithShares(uint256 share)
        public
        view
        returns (uint256 amountAfterFee, uint256 feeAmount)
    {
        uint256 currentAssetBalance = assetBalance();
        (
            uint256 withdrawAmount,
            uint256 newAssetBalance,
            uint256 newShareSupply
        ) = _withdrawAmountWithShares(share, currentAssetBalance);

        require(
            withdrawAmount <= currentAssetBalance,
            "Cannot withdraw more than available"
        );

        require(newShareSupply >= minimumSupply, "Insufficient supply");
        require(newAssetBalance >= minimumSupply, "Insufficient balance");

        feeAmount = wmul(withdrawAmount, instantWithdrawalFee);
        amountAfterFee = withdrawAmount.sub(feeAmount);
    }

    /**
     * @notice Helper function to return the `asset` amount returned using the `share` amount
     * @param share is the number of shares used to withdraw
     * @param currentAssetBalance is the value returned by totalBalance(). This is passed in to save gas.
     */
    function _withdrawAmountWithShares(
        uint256 share,
        uint256 currentAssetBalance
    )
        private
        view
        returns (
            uint256 withdrawAmount,
            uint256 newAssetBalance,
            uint256 newShareSupply
        )
    {
        uint256 total = lockedAmount.add(currentAssetBalance);

        uint256 shareSupply = totalSupply();

        // solhint-disable-next-line
        // Following the pool share calculation from Alpha Homora: https://github.com/AlphaFinanceLab/alphahomora/blob/340653c8ac1e9b4f23d5b81e61307bf7d02a26e8/contracts/5/Bank.sol#L111
        withdrawAmount = share.mul(total).div(shareSupply);
        newAssetBalance = total.sub(withdrawAmount);
        newShareSupply = shareSupply.sub(share);
    }

    /**
     * @notice Returns the max withdrawable shares for all users in the vault
     */
    function maxWithdrawableShares() public view returns (uint256) {
        uint256 withdrawableBalance = assetBalance();
        uint256 total = lockedAmount.add(withdrawableBalance);
        return
            withdrawableBalance
                .mul(totalSupply())
                .div(total)
                .sub(minimumSupply)
                .sub(queuedWithdrawShares);
    }

    /**
     * @notice Returns the max amount withdrawable by an account using the account's vault share balance
     * @param account is the address of the vault share holder
     * @return amount of `asset` withdrawable from vault, with fees accounted
     */
    function maxWithdrawAmount(address account)
        external
        view
        returns (uint256)
    {
        uint256 maxShares = maxWithdrawableShares();
        uint256 share = balanceOf(account);
        uint256 numShares = min(maxShares, share);

        (uint256 withdrawAmount, , ) =
            _withdrawAmountWithShares(numShares, assetBalance());

        return withdrawAmount;
    }

    /**
     * @notice Returns the number of shares for a given `assetAmount`.
     *         Used by the frontend to calculate withdraw amounts.
     * @param assetAmount is the asset amount to be withdrawn
     * @return share amount
     */
    function assetAmountToShares(uint256 assetAmount)
        external
        view
        returns (uint256)
    {
        uint256 total = lockedAmount.add(assetBalance());
        return assetAmount.mul(totalSupply()).div(total);
    }

    /**
     * @notice Returns an account's balance on the vault
     * @param account is the address of the user
     * @return vault balance of the user
     */
    function accountVaultBalance(address account)
        external
        view
        returns (uint256)
    {
        (uint256 withdrawAmount, , ) =
            _withdrawAmountWithShares(balanceOf(account), assetBalance());
        return withdrawAmount;
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
