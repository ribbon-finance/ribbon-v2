// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {GnosisAuction} from "../../libraries/GnosisAuction.sol";
import {Vault} from "../../libraries/Vault.sol";
import {VaultLifecycle} from "../../libraries/VaultLifecycle.sol";
import {VaultLifecycleSTETH} from "../../libraries/VaultLifecycleSTETH.sol";
import {ShareMath} from "../../libraries/ShareMath.sol";
import {RibbonVault} from "./base/RibbonVault.sol";
import {
    RibbonThetaSTETHVaultStorage
} from "../../storage/RibbonThetaSTETHVaultStorage.sol";

/**
 * UPGRADEABILITY: Since we use the upgradeable proxy pattern, we must observe
 * the inheritance chain closely.
 * Any changes/appends in storage variable needs to happen in RibbonThetaSTETHVaultStorage.
 * RibbonThetaSTETHVault should not inherit from any other contract aside from RibbonVault, RibbonThetaSTETHVaultStorage
 */
contract RibbonThetaSTETHVault is RibbonVault, RibbonThetaSTETHVaultStorage {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using ShareMath for Vault.DepositReceipt;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    /// @notice is the factory contract used to spawn otokens. Used to lookup otokens.
    address public immutable OTOKEN_FACTORY;

    // The minimum duration for an option auction.
    uint256 private constant MIN_AUCTION_DURATION = 1 hours;

    /************************************************
     *  EVENTS
     ***********************************************/

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
     * @param _wsteth is the LDO contract
     * @param _ldo is the LDO contract
     * @param _oTokenFactory is the contract address for minting new opyn option types (strikes, asset, expiry)
     * @param _gammaController is the contract address for opyn actions
     * @param _marginPool is the contract address for providing collateral to opyn
     * @param _gnosisEasyAuction is the contract address that facilitates gnosis auctions
     * @param _crvPool is the steth/eth crv stables pool
     */
    constructor(
        address _weth,
        address _usdc,
        address _wsteth,
        address _ldo,
        address _oTokenFactory,
        address _gammaController,
        address _marginPool,
        address _gnosisEasyAuction,
        address _crvPool
    )
        RibbonVault(
            _weth,
            _usdc,
            _wsteth,
            _ldo,
            _gammaController,
            _marginPool,
            _gnosisEasyAuction,
            _crvPool
        )
    {
        require(_oTokenFactory != address(0), "!_oTokenFactory");
        OTOKEN_FACTORY = _oTokenFactory;
    }

    /**
     * @notice Initializes the OptionVault contract with storage variables.
     * @param _owner is the owner of the vault with critical permissions
     * @param _keeper is the keeper of the vault with medium permissions (weekly actions)
     * @param _feeRecipient is the address to recieve vault performance and management fees
     * @param _managementFee is the management fee pct.
     * @param _performanceFee is the perfomance fee pct.
     * @param _tokenName is the name of the token
     * @param _tokenSymbol is the symbol of the token
     * @param _optionsPremiumPricer is the address of the contract with the
       black-scholes premium calculation logic
     * @param _strikeSelection is the address of the contract with strike selection logic
     * @param _premiumDiscount is the vault's discount applied to the premium
     * @param _auctionDuration is the duration of the gnosis auction
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
        address _optionsPremiumPricer,
        address _strikeSelection,
        uint32 _premiumDiscount,
        uint256 _auctionDuration,
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
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        require(_strikeSelection != address(0), "!_strikeSelection");
        require(
            _premiumDiscount > 0 &&
                _premiumDiscount < 100 * Vault.PREMIUM_DISCOUNT_MULTIPLIER,
            "!_premiumDiscount"
        );
        require(_auctionDuration >= MIN_AUCTION_DURATION, "!_auctionDuration");
        optionsPremiumPricer = _optionsPremiumPricer;
        strikeSelection = _strikeSelection;
        premiumDiscount = _premiumDiscount;
        auctionDuration = _auctionDuration;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

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
     * @notice Sets the new strike selection or options premium pricer contract
     * @param newContract is the address of the new strike selection or options premium pricer contract
     * @param isStrikeSelection is whether we are setting the strike selection contract
     */
    function setStrikeSelectionOrPricer(
        address newContract,
        bool isStrikeSelection
    ) external onlyOwner {
        require(newContract != address(0), "!newContract");
        if (isStrikeSelection) {
            strikeSelection = newContract;
        } else {
            optionsPremiumPricer = newContract;
        }
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

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param amount is the amount to withdraw in `asset`
     * @param minETHOut is the min amount of `asset` to recieve for the swapped amount of steth in crv pool
     */
    function withdrawInstantly(uint256 amount, uint256 minETHOut)
        external
        nonReentrant
    {
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

        // Unwrap may incur curve pool slippage
        uint256 amountETHOut =
            VaultLifecycleSTETH.unwrapYieldToken(
                amount,
                address(collateralToken),
                STETH_ETH_CRV_POOL,
                minETHOut
            );

        VaultLifecycleSTETH.transferAsset(msg.sender, amountETHOut);
    }

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external nonReentrant {
        address oldOption = optionState.currentOption;

        VaultLifecycle.CloseParams memory closeParams =
            VaultLifecycle.CloseParams({
                OTOKEN_FACTORY: OTOKEN_FACTORY,
                USDC: USDC,
                currentOption: oldOption,
                delay: DELAY,
                lastStrikeOverrideRound: lastStrikeOverrideRound,
                overriddenStrikePrice: overriddenStrikePrice
            });

        (
            address otokenAddress,
            uint256 premium,
            uint256 strikePrice,
            uint256 delta
        ) =
            VaultLifecycleSTETH.commitAndClose(
                strikeSelection,
                optionsPremiumPricer,
                premiumDiscount,
                closeParams,
                vaultParams,
                vaultState,
                address(collateralToken)
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
                VaultLifecycle.settleShort(GAMMA_CONTROLLER);
            emit CloseShort(oldOption, withdrawAmount, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external onlyKeeper nonReentrant {
        (address newOption, uint256 queuedWithdrawAmount) =
            _rollToNextOption(uint256(lastQueuedWithdrawAmount));

        lastQueuedWithdrawAmount = queuedWithdrawAmount;

        // Locked balance denominated in `collateralToken`
        uint256 lockedBalance =
            collateralToken.balanceOf(address(this)).sub(
                collateralToken.getWstETHByStETH(queuedWithdrawAmount)
            );

        emit OpenShort(newOption, lockedBalance, msg.sender);

        VaultLifecycleSTETH.createShort(
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

        auctionDetails.oTokenAddress = optionState.currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = vaultParams.asset;
        auctionDetails.assetDecimals = vaultParams.decimals;
        auctionDetails.oTokenPremium = currOtokenPremium;
        auctionDetails.duration = auctionDuration;

        optionAuctionID = VaultLifecycle.startAuction(auctionDetails);
    }

    /**
     * @notice Burn the remaining oTokens left over from gnosis auction.
     */
    function burnRemainingOTokens() external onlyKeeper nonReentrant {
        uint256 unlockedAssetAmount =
            VaultLifecycle.burnOtokens(
                GAMMA_CONTROLLER,
                optionState.currentOption
            );

        vaultState.lockedAmount = uint104(
            uint256(vaultState.lockedAmount).sub(unlockedAssetAmount)
        );

        // Wrap entire `asset` balance to `collateralToken` balance
        VaultLifecycleSTETH.wrapToYieldToken(WETH, address(collateralToken));
    }
}
