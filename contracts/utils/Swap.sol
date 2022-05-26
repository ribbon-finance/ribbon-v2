// SPDX-License-Identifier: MIT
// Source: https://github.com/airswap/airswap-protocols/blob/main/source/swap/contracts/Swap.sol

pragma solidity =0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "../interfaces/ISwap.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";

contract Swap is ISwap, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256(
            abi.encodePacked(
                "EIP712Domain(",
                "string name,",
                "string version,",
                "uint256 chainId,",
                "address verifyingContract",
                ")"
            )
        );

    bytes32 public constant BID_TYPEHASH =
        keccak256(
            abi.encodePacked(
                "Bid(",
                "uint256 swapId,",
                "uint256 nonce,",
                "address signerWallet,",
                "uint256 sellAmount,",
                "uint256 buyAmount,",
                "address referrer",
                ")"
            )
        );

    bytes32 public constant DOMAIN_NAME = keccak256("RIBBON SWAP");
    bytes32 public constant DOMAIN_VERSION = keccak256("1");
    uint256 public immutable DOMAIN_CHAIN_ID;
    bytes32 public immutable DOMAIN_SEPARATOR;

    uint256 internal constant MAX_PERCENTAGE = 10000;
    uint256 internal constant MAX_FEE = 1000;
    uint256 internal constant MAX_ERROR_COUNT = 10;
    uint256 internal constant OTOKEN_DECIMALS = 8;

    uint256 public offersCounter = 0;

    mapping(uint256 => Offer) public swapOffers;

    mapping(address => uint256) public referralFees;

    mapping(address => address) public authorized;

    /**
     * @notice Double mapping of signers to nonce groups to nonce states
     * @dev The nonce group is computed as nonce / 256, so each group of 256 sequential nonces uses the same key
     * @dev The nonce states are encoded as 256 bits, for each nonce in the group 0 means available and 1 means used
     */
    mapping(address => mapping(uint256 => uint256)) internal _nonceGroups;

    /************************************************
     *  CONSTRUCTOR
     ***********************************************/

    constructor() {
        uint256 currentChainId = getChainId();
        DOMAIN_CHAIN_ID = currentChainId;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                DOMAIN_NAME,
                DOMAIN_VERSION,
                currentChainId,
                this
            )
        );
    }

    /************************************************
     *  SETTER
     ***********************************************/

    /**
     * @notice Sets the referral fee for a specific referrer
     * @param referrer is the address of the referrer
     * @param fee is the fee in percent in 2 decimals
     */
    function setFee(address referrer, uint256 fee) external onlyOwner {
        require(referrer != address(0), "Referrer cannot be the zero address");
        require(fee < MAX_FEE, "Fee exceeds maximum");

        referralFees[referrer] = fee;

        emit SetFee(referrer, fee);
    }

    /************************************************
     *  OFFER CREATION AND SETTLEMENT
     ***********************************************/

    /**
     * @notice Create a new offer available for swap
     * @param oToken token offered by seller
     * @param biddingToken token asked by seller
     * @param minPrice minimum price of oToken denominated in biddingToken
     * @param minBidSize minimum amount of oToken requested in a single bid
     * @param totalSize amount of oToken offered by seller
     */
    function createOffer(
        address oToken,
        address biddingToken,
        uint96 minPrice,
        uint96 minBidSize,
        uint128 totalSize
    ) external override returns (uint256 swapId) {
        require(oToken != address(0), "oToken cannot be the zero address");
        require(
            biddingToken != address(0),
            "BiddingToken cannot be the zero address"
        );
        require(minPrice > 0, "MinPrice must be larger than zero");
        require(minBidSize > 0, "MinBidSize must be larger than zero");
        require(minBidSize <= totalSize, "MinBidSize exceeds total size");

        offersCounter += 1;

        swapId = offersCounter;

        swapOffers[swapId].seller = msg.sender;
        swapOffers[swapId].oToken = oToken;
        swapOffers[swapId].biddingToken = biddingToken;
        swapOffers[swapId].minBidSize = minBidSize;
        swapOffers[swapId].minPrice = minPrice;
        swapOffers[swapId].totalSize = totalSize;
        swapOffers[swapId].availableSize = totalSize;
        // We warm the storage slot with 1 wei so we avoid a cold SSTORE
        swapOffers[swapId].totalSales = 1;

        emit NewOffer(
            swapId,
            msg.sender,
            oToken,
            biddingToken,
            minPrice,
            minBidSize,
            totalSize
        );
    }

    /**
     * @notice Settles the swap offering by iterating through the bids
     * @param swapId unique identifier of the swap offer
     * @param bids bids for swaps
     */
    function settleOffer(uint256 swapId, Bid[] calldata bids)
        external
        override
        nonReentrant
    {
        Offer storage offer = swapOffers[swapId];

        address seller = offer.seller;
        require(
            seller == msg.sender,
            "Only seller can settle or offer doesn't exist"
        );
        require(offer.availableSize > 0, "Offer fully settled");

        uint256 totalSales;
        OfferDetails memory offerDetails;
        offerDetails.seller = seller;
        offerDetails.oToken = offer.oToken;
        offerDetails.biddingToken = offer.biddingToken;
        offerDetails.minPrice = offer.minPrice;
        offerDetails.minBidSize = offer.minBidSize;

        for (uint256 i = 0; i < bids.length; i++) {
            require(
                swapId == bids[i].swapId,
                "Offer and bid swapId mismatched"
            );

            _swap(offerDetails, offer, bids[i]);
            totalSales += bids[i].sellAmount;
        }

        bool fullySettled = offer.availableSize == 0;

        // Deduct the initial 1 wei offset if offer is fully settled
        offer.totalSales += totalSales - (fullySettled ? 1 : 0);

        if (fullySettled) {
            offer.seller = address(0);
            offer.oToken = address(0);
            offer.biddingToken = address(0);
            offer.minBidSize = 0;
            offer.minPrice = 0;

            emit SettleOffer(swapId);
        }
    }

    /**
     * @notice Authorize a signer
     * @param signer address Wallet of the signer to authorize
     * @dev Emits an Authorize event
     */
    function authorize(address signer) external override {
        require(signer != address(0), "SIGNER_INVALID");
        authorized[msg.sender] = signer;
        emit Authorize(signer, msg.sender);
    }

    /**
     * @notice Revoke the signer
     * @dev Emits a Revoke event
     */
    function revoke() external override {
        address tmp = authorized[msg.sender];
        delete authorized[msg.sender];
        emit Revoke(tmp, msg.sender);
    }

    /**
     * @notice Cancel one or more nonces
     * @dev Cancelled nonces are marked as used
     * @dev Emits a Cancel event
     * @dev Out of gas may occur in arrays of length > 400
     * @param nonces uint256[] List of nonces to cancel
     */
    function cancelNonce(uint256[] calldata nonces) external override {
        for (uint256 i = 0; i < nonces.length; i++) {
            uint256 nonce = nonces[i];
            if (_markNonceAsUsed(msg.sender, nonce)) {
                emit Cancel(nonce, msg.sender);
            }
        }
    }

    /************************************************
     *  PUBLIC VIEW FUNCTIONS
     ***********************************************/

    /**
     * @notice Validates Swap bid for any potential errors
     * @param bid Bid struct containing bid details
     * @return tuple of error count and bytes32[] memory array of error messages
     */
    function check(Bid calldata bid)
        external
        view
        override
        returns (uint256, bytes32[] memory)
    {
        Offer memory offer = swapOffers[bid.swapId];
        require(offer.seller != address(0), "Offer does not exist");

        bytes32[] memory errors = new bytes32[](MAX_ERROR_COUNT);

        uint256 errCount;

        // Check signature
        address signatory = _getSignatory(bid);

        if (signatory == address(0)) {
            errors[errCount] = "SIGNATURE_INVALID";
            errCount++;
        }

        if (
            bid.signerWallet != signatory &&
            authorized[bid.signerWallet] != signatory
        ) {
            errors[errCount] = "UNAUTHORIZED";
            errCount++;
        }

        // Check nonce
        if (nonceUsed(signatory, bid.nonce)) {
            errors[errCount] = "NONCE_ALREADY_USED";
            errCount++;
        }

        // Check bid size
        if (bid.buyAmount < offer.minBidSize) {
            errors[errCount] = "BID_TOO_SMALL";
            errCount++;
        }
        if (bid.buyAmount > offer.availableSize) {
            errors[errCount] = "BID_EXCEED_AVAILABLE_SIZE";
            errCount++;
        }

        // Check bid price
        uint256 bidPrice =
            (bid.sellAmount * 10**OTOKEN_DECIMALS) / bid.buyAmount;
        if (bidPrice < offer.minPrice) {
            errors[errCount] = "PRICE_TOO_LOW";
            errCount++;
        }

        // Check signer allowance
        uint256 signerAllowance =
            IERC20(offer.biddingToken).allowance(
                bid.signerWallet,
                address(this)
            );
        if (signerAllowance < bid.sellAmount) {
            errors[errCount] = "SIGNER_ALLOWANCE_LOW";
            errCount++;
        }

        // Check signer balance
        uint256 signerBalance =
            IERC20(offer.biddingToken).balanceOf(bid.signerWallet);
        if (signerBalance < bid.sellAmount) {
            errors[errCount] = "SIGNER_BALANCE_LOW";
            errCount++;
        }

        // Check seller allowance
        uint256 sellerAllowance =
            IERC20(offer.oToken).allowance(offer.seller, address(this));
        if (sellerAllowance < bid.buyAmount) {
            errors[errCount] = "SELLER_ALLOWANCE_LOW";
            errCount++;
        }

        // Check seller balance
        uint256 sellerBalance = IERC20(offer.oToken).balanceOf(offer.seller);
        if (sellerBalance < bid.buyAmount) {
            errors[errCount] = "SELLER_BALANCE_LOW";
            errCount++;
        }

        return (errCount, errors);
    }

    /**
     * @notice Returns the average settlement price for a swap offer
     * @param swapId unique identifier of the swap offer
     */
    function averagePriceForOffer(uint256 swapId)
        external
        view
        override
        returns (uint256)
    {
        Offer storage offer = swapOffers[swapId];
        require(offer.totalSize != 0, "Offer does not exist");

        uint256 availableSize = offer.availableSize;

        // Deduct the initial 1 wei offset if offer is not fully settled
        uint256 adjustment = availableSize != 0 ? 1 : 0;

        return
            ((offer.totalSales - adjustment) * (10**8)) /
            (offer.totalSize - availableSize);
    }

    /**
     * @notice Returns true if the nonce has been used
     * @param signer address Address of the signer
     * @param nonce uint256 Nonce being checked
     */
    function nonceUsed(address signer, uint256 nonce)
        public
        view
        override
        returns (bool)
    {
        uint256 groupKey = nonce / 256;
        uint256 indexInGroup = nonce % 256;
        return (_nonceGroups[signer][groupKey] >> indexInGroup) & 1 == 1;
    }

    /************************************************
     *  INTERNAL FUNCTIONS
     ***********************************************/

    /**
     * @notice Swap Atomic ERC20 Swap
     * @param details Details of offering
     * @param offer Offer struct containing offer details
     * @param bid Bid struct containing bid details
     */
    function _swap(
        OfferDetails memory details,
        Offer storage offer,
        Bid calldata bid
    ) internal {
        require(DOMAIN_CHAIN_ID == getChainId(), "CHAIN_ID_CHANGED");

        address signatory = _getSignatory(bid);

        if (bid.signerWallet != signatory) {
            require(authorized[bid.signerWallet] == signatory, "UNAUTHORIZED");
        }

        require(signatory != address(0), "SIGNATURE_INVALID");

        require(_markNonceAsUsed(signatory, bid.nonce), "NONCE_ALREADY_USED");
        require(
            bid.buyAmount <= offer.availableSize,
            "BID_EXCEED_AVAILABLE_SIZE"
        );
        require(bid.buyAmount >= details.minBidSize, "BID_TOO_SMALL");

        // Ensure min. price is met
        uint256 bidPrice =
            (bid.sellAmount * 10**OTOKEN_DECIMALS) / bid.buyAmount;
        require(bidPrice >= details.minPrice, "PRICE_TOO_LOW");

        // don't have to do a uint128 check because we already check
        // that bid.buyAmount <= offer.availableSize
        offer.availableSize -= uint128(bid.buyAmount);

        // Transfer token from sender to signer
        IERC20(details.oToken).safeTransferFrom(
            details.seller,
            bid.signerWallet,
            bid.buyAmount
        );

        // Transfer to referrer if any
        uint256 feeAmount;
        if (bid.referrer != address(0)) {
            uint256 feePercent = referralFees[bid.referrer];

            if (feePercent > 0) {
                feeAmount = (bid.sellAmount * feePercent) / MAX_PERCENTAGE;

                IERC20(details.biddingToken).safeTransferFrom(
                    bid.signerWallet,
                    bid.referrer,
                    feeAmount
                );
            }
        }

        // Transfer token from signer to recipient
        IERC20(details.biddingToken).safeTransferFrom(
            bid.signerWallet,
            details.seller,
            bid.sellAmount - feeAmount
        );

        // Emit a Swap event
        emit Swap(
            bid.swapId,
            bid.nonce,
            bid.signerWallet,
            bid.sellAmount,
            bid.buyAmount,
            bid.referrer,
            feeAmount
        );
    }

    /**
     * @notice Marks a nonce as used for the given signer
     * @param signer address Address of the signer for which to mark the nonce as used
     * @param nonce uint256 Nonce to be marked as used
     * @return bool True if the nonce was not marked as used already
     */
    function _markNonceAsUsed(address signer, uint256 nonce)
        internal
        returns (bool)
    {
        uint256 groupKey = nonce / 256;
        uint256 indexInGroup = nonce % 256;
        uint256 group = _nonceGroups[signer][groupKey];

        // If it is already used, return false
        if ((group >> indexInGroup) & 1 == 1) {
            return false;
        }

        _nonceGroups[signer][groupKey] = group | (uint256(1) << indexInGroup);

        return true;
    }

    /**
     * @notice Recover the signatory from a signature
     * @param bid Bid struct containing bid details
     */
    function _getSignatory(Bid calldata bid) internal view returns (address) {
        return
            ecrecover(
                keccak256(
                    abi.encodePacked(
                        "\x19\x01",
                        DOMAIN_SEPARATOR,
                        keccak256(
                            abi.encode(
                                BID_TYPEHASH,
                                bid.swapId,
                                bid.nonce,
                                bid.signerWallet,
                                bid.sellAmount,
                                bid.buyAmount,
                                bid.referrer
                            )
                        )
                    )
                ),
                bid.v,
                bid.r,
                bid.s
            );
    }

    /**
     * @notice Returns the current chainId using the chainid opcode
     * @return id uint256 The chain id
     */
    function getChainId() internal view returns (uint256 id) {
        // no-inline-assembly
        assembly {
            id := chainid()
        }
    }
}
