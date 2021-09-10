// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {GnosisAuction} from "../../libraries/GnosisAuction.sol";
import {Vault} from "../../libraries/Vault.sol";
import {VaultLifecycleSTETH} from "../../libraries/VaultLifecycleSTETH.sol";
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
    using SafeMath for uint256;

    /************************************************
     *  IMMUTABLES & CONSTANTS
     ***********************************************/

    // oTokenFactory is the factory contract used to spawn otokens. Used to lookup otokens.
    address public immutable OTOKEN_FACTORY;

    /************************************************
     *  EVENTS
     ***********************************************/

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

    event InstantWithdraw(
        address indexed account,
        uint256 amount,
        uint256 round
    );

    event InitiateGnosisAuction(
        address auctioningToken,
        address biddingToken,
        uint256 auctionCounter,
        address manager
    );

    /************************************************
     *  CONSTRUCTOR & INITIALIZATION
     ***********************************************/

    /**
     * @notice Initializes the contract with immutable variables
     * @param _weth is the Wrapped Ether contract
     * @param _usdc is the USDC contract
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
     */
    function initialize(
        address _owner,
        address _keeper,
        address _feeRecipient,
        uint256 _managementFee,
        uint256 _performanceFee,
        string memory tokenName,
        string memory tokenSymbol,
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
            tokenName,
            tokenSymbol,
            _vaultParams
        );
        require(_optionsPremiumPricer != address(0), "!_optionsPremiumPricer");
        require(_strikeSelection != address(0), "!_strikeSelection");
        require(
            _premiumDiscount > 0 && _premiumDiscount < 1000,
            "!_premiumDiscount"
        );
        require(_auctionDuration >= 1 hours, "!_auctionDuration");
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
            newPremiumDiscount > 0 && newPremiumDiscount < 1000,
            "Invalid discount"
        );

        premiumDiscount = newPremiumDiscount;
    }

    /**
     * @notice Sets the new auction duration
     * @param newAuctionDuration is the auction duration
     */
    function setAuctionDuration(uint256 newAuctionDuration) external onlyOwner {
        require(newAuctionDuration >= 1 hours, "!newAuctionDuration");

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

        // Subtraction underflow checks already ensure it is smaller than uint104
        depositReceipt.amount = uint104(uint256(receiptAmount).sub(amount));

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

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Sets the next option the vault will be shorting, and closes the existing short.
     *         This allows all the users to withdraw if the next option is malicious.
     */
    function commitAndClose() external nonReentrant {
        address oldOption = optionState.currentOption;

        VaultLifecycleSTETH.CloseParams memory closeParams =
            VaultLifecycleSTETH.CloseParams({
                OTOKEN_FACTORY: OTOKEN_FACTORY,
                USDC: USDC,
                currentOption: oldOption,
                delay: DELAY,
                lastStrikeOverride: lastStrikeOverrideRound,
                overriddenStrikePrice: overriddenStrikePrice
            });

        (address otokenAddress, uint256 premium, , ) =
            VaultLifecycleSTETH.commitAndClose(
                strikeSelection,
                optionsPremiumPricer,
                premiumDiscount,
                closeParams,
                vaultParams,
                vaultState,
                address(collateralToken)
            );

        currentOtokenPremium = uint104(premium);
        optionState.nextOption = otokenAddress;
        optionState.nextOptionReadyAt = uint32(block.timestamp.add(DELAY));

        _closeShort(oldOption);
    }

    /**
     * @notice Closes the existing short position for the vault.
     */
    function _closeShort(address oldOption) private {
        optionState.currentOption = address(0);

        uint256 lockedAmount = vaultState.lockedAmount;
        vaultState.lastLockedAmount = lockedAmount > 0
            ? uint104(lockedAmount)
            : vaultState.lastLockedAmount;
        vaultState.lockedAmount = 0;

        if (oldOption != address(0)) {
            uint256 withdrawAmount =
                VaultLifecycleSTETH.settleShort(GAMMA_CONTROLLER);
            emit CloseShort(oldOption, withdrawAmount, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external onlyKeeper nonReentrant {
        (address newOption, uint256 queuedWithdrawAmount) = _rollToNextOption();

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

        startAuction();
    }

    /**
     * @notice Initiate the gnosis auction.
     */
    function startAuction() public onlyKeeper {
        GnosisAuction.AuctionDetails memory auctionDetails;

        uint256 currOtokenPremium = currentOtokenPremium;

        require(currOtokenPremium > 0, "!currentOtokenPremium");

        auctionDetails.oTokenAddress = optionState.currentOption;
        auctionDetails.gnosisEasyAuction = GNOSIS_EASY_AUCTION;
        auctionDetails.asset = vaultParams.asset;
        auctionDetails.assetDecimals = vaultParams.decimals;
        auctionDetails.oTokenPremium = currOtokenPremium;
        auctionDetails.duration = auctionDuration;

        optionAuctionID = VaultLifecycleSTETH.startAuction(auctionDetails);
    }

    /**
     * @notice Burn the remaining oTokens left over from gnosis auction.
     */
    function burnRemainingOTokens() external onlyKeeper nonReentrant {
        uint256 unlockedAssedAmount =
            VaultLifecycleSTETH.burnOtokens(
                GAMMA_CONTROLLER,
                optionState.currentOption
            );

        if (unlockedAssedAmount > 0) {
            vaultState.lockedAmount = uint104(
                uint256(vaultState.lockedAmount).sub(unlockedAssedAmount)
            );
        }

        // Wrap entire `asset` balance to `collateralToken` balance
        VaultLifecycleSTETH.wrapToYieldToken(WETH, address(collateralToken));
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
}
