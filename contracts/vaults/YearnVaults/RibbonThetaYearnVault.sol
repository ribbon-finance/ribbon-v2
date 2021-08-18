// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {GnosisAuction} from "../../libraries/GnosisAuction.sol";
import {Vault} from "../../libraries/Vault.sol";
import {VaultLifecycleYearn} from "../../libraries/VaultLifecycleYearn.sol";
import {RibbonVault} from "./base/RibbonVault.sol";
import {
    OptionsThetaYearnVaultStorage
} from "../../storage/OptionsVaultYearnStorage.sol";

contract RibbonThetaYearnVault is RibbonVault, OptionsThetaYearnVaultStorage {
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
     * @param _oTokenFactory is the contract address for minting new opyn option types (strikes, asset, expiry)
     * @param _gammaController is the contract address for opyn actions
     * @param _marginPool is the contract address for providing collateral to opyn
     * @param _gnosisEasyAuction is the contract address that facilitates gnosis auctions
     * @param _yearnRegistry is the address of the yearn registry from token to vault token
     */
    constructor(
        address _weth,
        address _usdc,
        address _oTokenFactory,
        address _gammaController,
        address _marginPool,
        address _gnosisEasyAuction,
        address _yearnRegistry
    )
        RibbonVault(
            _weth,
            _usdc,
            _gammaController,
            _marginPool,
            _gnosisEasyAuction,
            _yearnRegistry
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
    function setPremiumDiscount(uint16 newPremiumDiscount) external onlyOwner {
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
     * @notice Withdraws the assets on the vault using the outstanding `DepositReceipt.amount`
     * @param amount is the amount to withdraw in `asset`
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

        // Subtraction underflow checks already ensure it is smaller than uint104
        depositReceipt.amount = uint104(uint256(receiptAmount).sub(amount));

        emit InstantWithdraw(msg.sender, amount, currentRound);

        VaultLifecycleYearn.unwrapYieldToken(
            amount,
            vaultParams.asset,
            address(collateralToken),
            YEARN_WITHDRAWAL_BUFFER,
            YEARN_WITHDRAWAL_SLIPPAGE
        );
        VaultLifecycleYearn.transferAsset(
            WETH,
            vaultParams.asset,
            msg.sender,
            amount
        );
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

        VaultLifecycleYearn.CloseParams memory closeParams =
            VaultLifecycleYearn.CloseParams({
                OTOKEN_FACTORY: OTOKEN_FACTORY,
                USDC: USDC,
                currentOption: oldOption,
                delay: delay,
                lastStrikeOverride: lastStrikeOverride,
                overriddenStrikePrice: overriddenStrikePrice
            });

        (address otokenAddress, uint256 premium, , ) =
            VaultLifecycleYearn.commitAndClose(
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
        optionState.nextOptionReadyAt = uint32(block.timestamp.add(delay));

        _closeShort(oldOption);
    }

    /**
     * @notice Closes the existing short position for the vault.
     */
    function _closeShort(address oldOption) private {
        optionState.currentOption = address(0);

        uint104 lockedAmount = vaultState.lockedAmount;
        vaultState.lastLockedAmount = lockedAmount > 0
            ? lockedAmount
            : vaultState.lastLockedAmount;
        vaultState.lockedAmount = 0;

        if (oldOption != address(0)) {
            uint256 withdrawAmount =
                VaultLifecycleYearn.settleShort(GAMMA_CONTROLLER);
            emit CloseShort(oldOption, withdrawAmount, msg.sender);
        }
    }

    /**
     * @notice Rolls the vault's funds into a new short position.
     */
    function rollToNextOption() external onlyKeeper nonReentrant {
        (address newOption, uint256 queuedWithdrawAmount) = _rollToNextOption();

        // Locked balance denominated in `collateralToken`
        // there is a slight imprecision with regards to calculating back from yearn token -> underlying
        // that stems from miscoordination between ytoken .deposit() amount wrapped and pricePerShare
        // at that point in time.
        // ex: if I have 1 eth, deposit 1 eth into yearn vault and calculate value of yearn token balance
        // denominated in eth (via balance(yearn token) * pricePerShare) we will get 1 eth - 1 wei.

        // We are subtracting `collateralAsset` balance by queuedWithdrawAmount denominated in `collateralAsset` plus
        // a buffer for withdrawals taking into account slippage from yearn vault

        uint256 lockedBalance =
            collateralToken.balanceOf(address(this)).sub(
                VaultLifecycleYearn.dswdiv(
                    queuedWithdrawAmount.add(
                        queuedWithdrawAmount.mul(YEARN_WITHDRAWAL_BUFFER).div(
                            10000
                        )
                    ),
                    collateralToken.pricePerShare().mul(
                        VaultLifecycleYearn.decimalShift(
                            address(collateralToken)
                        )
                    )
                )
            );

        emit OpenShort(newOption, lockedBalance, msg.sender);

        VaultLifecycleYearn.createShort(
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

        optionAuctionID = VaultLifecycleYearn.startAuction(auctionDetails);
    }

    /**
     * @notice Burn the remaining oTokens left over from gnosis auction.
     */
    function burnRemainingOTokens() external onlyKeeper nonReentrant {
        uint256 unlockedAssedAmount =
            VaultLifecycleYearn.burnOtokens(
                GAMMA_CONTROLLER,
                optionState.currentOption
            );

        if (unlockedAssedAmount > 0) {
            vaultState.lockedAmount = uint104(
                uint256(vaultState.lockedAmount).sub(unlockedAssedAmount)
            );
        }

        // Wrap entire `asset` balance to `collateralToken` balance
        VaultLifecycleYearn.wrapToYieldToken(
            vaultParams.asset,
            address(collateralToken)
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
        overriddenStrikePrice = strikePrice;
        lastStrikeOverride = vaultState.round;
    }
}
