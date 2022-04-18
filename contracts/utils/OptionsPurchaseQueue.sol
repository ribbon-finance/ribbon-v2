// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {
    SafeERC20
} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IOptionsPurchaseQueue} from "../interfaces/IOptionsPurchaseQueue.sol";
import {IRibbonThetaVault} from "../interfaces/IRibbonThetaVault.sol";
import {Vault} from "../libraries/Vault.sol";

contract OptionsPurchaseQueue is IOptionsPurchaseQueue, Ownable {
    using SafeERC20 for IERC20;

    /************************************************
     *  STORAGE
     ***********************************************/

    /// @notice Stores the purchase queue for each vault
    mapping(address => Purchase[]) public override purchases;

    /// @notice Stores the total options being purchased for each vault
    mapping(address => uint256) public override totalOptionsAmount;

    /// @notice Stores the amount of options the vault is allocating towards the purchase queue
    /// @dev When vaultAllocatedOptions != 0, new purchase requests for the vault are blocked since the vault has
    ///  already allocated options for this contract
    mapping(address => uint256) public override vaultAllocatedOptions;

    /// @notice Stores whether a buyer is whitelisted
    mapping(address => bool) public override whitelistedBuyer;

    /// @notice Stores the ceiling price of a vaults options
    /// @dev If the ceilingPrice != 0, then the vault is available for requesting purchases
    mapping(address => uint256) public override ceilingPrice;

    /// @notice Minimum amount of options a buyer needs to request from a vault, necessary to prevent the purchase
    ///  queue from getting griefed
    /// @dev Buyers on the whitelist are exempted from this requirement
    mapping(address => uint256) public override minPurchaseAmount;

    /************************************************
     *  EVENTS
     ***********************************************/

    /**
     * @notice Emitted when a purchase is requested
     * @param buyer The buyer requesting the purchase
     * @param vault The vault the buyer is purchasing from
     * @param optionsAmount Amount of options requested
     * @param premiums Total premiums from the buyers (optionsAmount * ceilingPrice)
     */
    event PurchaseRequested(
        address indexed buyer,
        address indexed vault,
        uint256 optionsAmount,
        uint256 premiums
    );

    /**
     * @notice Emitted when a purchase is cancelled
     * @param buyer The buyer cancelling their purchase
     * @param vault The vault the buyer was purchasing from
     * @param optionsAmount Amount of options cancelled
     * @param premiums Total premiums transferred back to the buyer
     */
    event PurchaseCancelled(
        address indexed buyer,
        address indexed vault,
        uint256 optionsAmount,
        uint256 premiums
    );

    /**
     * @notice Emitted when the vault allocates options to be sold to the buyers
     * @param vault The vault allocating options
     * @param allocatedOptions Amount of options allocated
     */
    event OptionsAllocated(address indexed vault, uint256 allocatedOptions);

    /**
     * @notice Emitted when the vault sells options to the buyers
     * @param vault The vault selling the options
     * @param totalPremiums Total premiums earnt by the vault
     * @param totalOptions Total options transferred to the buyers (allocatedOptions)
     */
    event OptionsSold(
        address indexed vault,
        uint256 totalPremiums,
        uint256 totalOptions
    );

    /**
     * @notice Emitted when a buyer is whitelisted for purchasing options
     * @param buyer The whitelisted buyer
     */
    event AddWhitelist(address indexed buyer);

    /**
     * @notice Emitted when a buyer is removed from the whitelist for purchasing options
     * @param buyer The blacklisted buyer
     */
    event RemoveWhitelist(address indexed buyer);

    /**
     * @notice Emitted when the ceiling price for a vault is updated
     * @param vault The vault
     * @param ceilingPrice The new ceiling price
     */
    event CeilingPriceUpdated(address indexed vault, uint256 ceilingPrice);

    /**
     * @notice Emitted when the minimum purchase amount for a vault is updated
     * @param vault The vault
     * @param optionsAmount The new minimum purchase amount
     */
    event MinPurchaseAmountUpdated(
        address indexed vault,
        uint256 optionsAmount
    );

    /************************************************
     *  BUYER OPERATIONS
     ***********************************************/

    /**
     * @notice Create a request to purchase options from a vault at the auction settlement price
     * @dev The buyer must be whitelisted to prevent the purchase queue from getting griefed (since sellToBuyers()
     *  iterates through it). This function transfers the premiums for the options from the buyer at the ceiling
     *  price (maximum price the buyer has to pay), however when the options are sold the buyer only pays the
     *  auction settlement price and the leftover premiums are transferred back to the buyer. This function will
     *  revert after the vault calls allocateOptions. New purchases can be made after the vault calls sellToBuyers().
     *  The requests on the purchased queue are filled FIFO. Any unfilled/partially filled requests are refunded
     *  their premiums, this can occur when the vault allocates less options than there are on the queue.
     * @param vault The vault to purchase options from
     * @param optionsAmount Amount of options requested
     * @return premiums Amount of premiums transferred from the buyer
     */
    function requestPurchase(address vault, uint256 optionsAmount)
        external
        override
        returns (uint256)
    {
        uint256 _ceilingPrice = ceilingPrice[vault];
        require(_ceilingPrice != 0, "Invalid vault");
        require(optionsAmount != 0, "!optionsAmount");
        // Exempt buyers on the whitelist from the minimum purchase requirement
        require(
            optionsAmount >= minPurchaseAmount[vault] ||
                whitelistedBuyer[msg.sender],
            "Minimum purchase requirement"
        );
        // This prevents new purchase requested after the vault has set its allocation
        require(vaultAllocatedOptions[vault] == 0, "Vault allocated");

        // premiums = optionsAmount * ceilingPrice
        uint256 premiums =
            (optionsAmount * _ceilingPrice) / (10**Vault.OTOKEN_DECIMALS);

        // Add purchase to queue
        purchases[vault].push(
            Purchase(
                SafeCast.toUint128(optionsAmount),
                SafeCast.toUint128(premiums),
                msg.sender
            )
        );

        totalOptionsAmount[vault] += optionsAmount;

        // Transfer premiums from the buyer to this contract
        IERC20(IRibbonThetaVault(vault).vaultParams().asset).safeTransferFrom(
            msg.sender,
            address(this),
            premiums
        );

        emit PurchaseRequested(msg.sender, vault, optionsAmount, premiums);

        return premiums;
    }

    /************************************************
     *  VAULT OPERATIONS
     ***********************************************/

    /**
     * @notice Allocate options to the purchase queue
     * @dev Only callable by the vault selling options. Since we cannot allocate more options than there are on the
     *  purchase queue, we cap the allocated options at the totalOptionsAmount. The vault decides how many options
     *  of its options it wants to allocate. Allows allocating additional options if already called. Transfers the
     *  options from the vault to this contract.
     * @param allocatedOptions Maximum amount of options the vault can allocate to buyers
     * @return allocatedOptions The actual amount of options allocated
     */
    function allocateOptions(uint256 allocatedOptions)
        external
        override
        returns (uint256)
    {
        require(ceilingPrice[msg.sender] != 0, "Not vault");

        // Prevent the vault from allocating more options than there are requested
        allocatedOptions = getOptionsAllocation(msg.sender, allocatedOptions);

        // Blocks new purchase requests until sellToBuyers() is called
        vaultAllocatedOptions[msg.sender] += allocatedOptions;

        if (allocatedOptions != 0) {
            // Transfer allocated options from the vault to this contract
            IERC20(IRibbonThetaVault(msg.sender).currentOption())
                .safeTransferFrom(msg.sender, address(this), allocatedOptions);
        }

        emit OptionsAllocated(msg.sender, allocatedOptions);

        return allocatedOptions;
    }

    /**
     * @notice Sells allocated options to the buyers on the purchase queue
     * @dev Only callable by the vault. Lets say the vault starts an auction and it doesn't fully fill and
     *  settles at a poor price. If this function were callable by anyone, then they could sell the allocated
     *  options to the buyers at the poor price. Hence the vault should call this once its auction has settled at a
     *  good price. The vault must allocate options first, otherwise all the buyers are returned their premiums.
     *  The buyers receive their options at the auction settlement price and any leftover premiums are refunded.
     *  If the auction settles above the ceiling price, the vault receives the premiums at the ceiling price (so it
     *  receives premiums at a worse price than the auction) and the buyers are not refunded.
     * @param settlementPrice The vault passes in the settlement price of the options
     * @return totalPremiums The total premiums the vault received from the purchase queue
     */
    function sellToBuyers(uint256 settlementPrice)
        external
        override
        returns (uint256)
    {
        require(ceilingPrice[msg.sender] != 0, "Not vault");

        uint256 totalPremiums;
        uint256 allocatedOptions = vaultAllocatedOptions[msg.sender];
        uint256 totalOptions = allocatedOptions; // Cache allocatedOptions here for emitting an event later
        IERC20 currentOption =
            IERC20(IRibbonThetaVault(msg.sender).currentOption());
        IERC20 asset =
            IERC20(IRibbonThetaVault(msg.sender).vaultParams().asset);
        Purchase[] memory purchaseQueue = purchases[msg.sender];

        for (uint256 i; i < purchaseQueue.length; i++) {
            if (allocatedOptions == 0) {
                // Transfer premiums back to the buyer if no options are left
                asset.safeTransfer(
                    purchaseQueue[i].buyer,
                    purchaseQueue[i].premiums
                );
            } else {
                // Prevent transferring more options than there are allocated
                // optionsAmount = min(purchase.optionsAmount, allocatedOptions)
                uint256 optionsAmount =
                    purchaseQueue[i].optionsAmount < allocatedOptions
                        ? purchaseQueue[i].optionsAmount
                        : allocatedOptions;

                // premiums = optionsAmount * settlementPrice
                uint256 premiums =
                    (optionsAmount * settlementPrice) /
                        (10**Vault.OTOKEN_DECIMALS);

                if (premiums < purchaseQueue[i].premiums) {
                    // Transfer leftover premiums back to the buyer
                    asset.safeTransfer(
                        purchaseQueue[i].buyer,
                        purchaseQueue[i].premiums - premiums
                    );

                    totalPremiums += premiums;
                } else {
                    // If the settlement price exceed the buyer's price (ceiling price), the vault receives all
                    // of the buyer's premiums at a worse price than the auction
                    totalPremiums += purchaseQueue[i].premiums;
                }

                // Transfer options to the buyer
                currentOption.safeTransfer(
                    purchaseQueue[i].buyer,
                    optionsAmount
                );

                // Deduct transferred options from allocatedOptions
                allocatedOptions -= optionsAmount;
            }
        }

        // Transfer premiums to the vault
        if (totalPremiums != 0) asset.safeTransfer(msg.sender, totalPremiums);

        // Clear purchase queue
        delete purchases[msg.sender];
        totalOptionsAmount[msg.sender] = 0;
        // Purchase requests are unblocked
        vaultAllocatedOptions[msg.sender] = 0;

        emit OptionsSold(msg.sender, totalPremiums, totalOptions);

        return totalPremiums;
    }

    /************************************************
     *  OWNER OPERATIONS
     ***********************************************/

    /**
     * @notice Cancels all purchase requests for a delisted vault
     * @dev Only callable by the owner. Will revert if options have already been allocated by the vault.
     * @param vault The vault to cancel all purchases for
     */
    function cancelAllPurchases(address vault) external override onlyOwner {
        // Revert if the vault is still listed
        require(ceilingPrice[vault] == 0, "Vault listed");
        // This prevents cancellations after the vault has set its allocation
        require(vaultAllocatedOptions[vault] == 0, "Vault allocated");

        IERC20 asset = IERC20(IRibbonThetaVault(vault).vaultParams().asset);
        Purchase[] memory purchaseQueue = purchases[vault];

        for (uint256 i; i < purchaseQueue.length; i++) {
            // Refund premiums to the buyer
            asset.safeTransfer(
                purchaseQueue[i].buyer,
                purchaseQueue[i].premiums
            );

            emit PurchaseCancelled(
                purchaseQueue[i].buyer,
                vault,
                purchaseQueue[i].optionsAmount,
                purchaseQueue[i].premiums
            );
        }

        // Clear purchase queue
        delete purchases[vault];
        totalOptionsAmount[vault] = 0;
    }

    /************************************************
     *  SETTERS
     ***********************************************/

    /**
     * @notice Adds a buyer to the purchase queue whitelist
     * @dev Only callable by the owner
     * @param buyer The buyer to whitelist
     */
    function addWhitelist(address buyer) external override onlyOwner {
        require(buyer != address(0), "!buyer");

        whitelistedBuyer[buyer] = true;

        emit AddWhitelist(buyer);
    }

    /**
     * @notice Removes a buyer from the purchase queue whitelist
     * @dev Only callable by the owner
     * @param buyer The buyer to remove from the whitelist
     */
    function removeWhitelist(address buyer) external override onlyOwner {
        require(buyer != address(0), "!buyer");

        whitelistedBuyer[buyer] = false;

        emit RemoveWhitelist(buyer);
    }

    /**
     * @notice Set the ceiling price for a vault
     * @dev Only callable by the owner
     * @param vault The vault to set a ceiling price for
     * @param price The ceiling price
     */
    function setCeilingPrice(address vault, uint256 price)
        external
        override
        onlyOwner
    {
        require(vault != address(0), "!vault");

        // Setting the ceiling price to 0 is the same as delisting a vault
        ceilingPrice[vault] = price;

        emit CeilingPriceUpdated(vault, price);
    }

    /**
     * @notice Sets the minimum purchase amount for a vault
     * @dev Only callable by the owner
     * @param vault The vault to set the minimum purchase amount for
     * @param optionsAmount The minimum options purchase amount
     */
    function setMinPurchaseAmount(address vault, uint256 optionsAmount)
        external
        override
        onlyOwner
    {
        require(vault != address(0), "!vault");

        minPurchaseAmount[vault] = optionsAmount;

        emit MinPurchaseAmountUpdated(vault, optionsAmount);
    }

    /************************************************
     *  GETTERS
     ***********************************************/

    /**
     * @notice Gets all the purchase requests for a vault
     * @param vault The vault to get purchase requests for
     * @return purchases The purchase array
     */
    function getPurchases(address vault)
        external
        view
        override
        returns (Purchase[] memory)
    {
        return purchases[vault];
    }

    /**
     * @notice Gets the premiums the buyer needs to deposit to request a certain amount of options
     * @param vault The vault to purchase options from
     * @param optionsAmount Amount of options requested
     * @return premiums Premiums required to request a purchase
     */
    function getPremiums(address vault, uint256 optionsAmount)
        external
        view
        override
        returns (uint256)
    {
        // premiums = optionsAmount * ceilingPrice
        return
            (optionsAmount * ceilingPrice[vault]) / (10**Vault.OTOKEN_DECIMALS);
    }

    /**
     * @notice Gets the amount of options the vault can allocate to the queue
     * @param vault The vault selling options to the queue
     * @param allocatedOptions Maximum amount of options the vault can allocate to the queue
     * @return allocatedOptions Actual amount of options the vault allocates to the queue
     */
    function getOptionsAllocation(address vault, uint256 allocatedOptions)
        public
        view
        override
        returns (uint256)
    {
        // Prevent the vault from allocating more options than there are requested
        uint256 optionsAmount =
            totalOptionsAmount[vault] - vaultAllocatedOptions[vault];
        // allocatedOptions = min(allocatedOptions, totalOptionsAmount[vault] - vaultAllocatedOptions[vault])
        return
            optionsAmount < allocatedOptions ? optionsAmount : allocatedOptions;
    }
}
