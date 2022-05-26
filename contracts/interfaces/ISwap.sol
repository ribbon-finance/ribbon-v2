// SPDX-License-Identifier: MIT

pragma solidity =0.8.4;

interface ISwap {
    struct Offer {
        // 32 byte slot 1, partial fill
        // Seller wallet address
        address seller;
        // 32 byte slot 2
        // Addess of oToken
        address oToken;
        // Price per oToken denominated in biddingToken
        uint96 minPrice;
        // 32 byte slot 3
        // ERC20 Token to bid for oToken
        address biddingToken;
        // Minimum oToken amount acceptable for a single bid
        uint96 minBidSize;
        // 32 byte slot 4
        // Total available oToken amount
        uint128 totalSize;
        // Remaining available oToken amount
        // This figure is updated after each successfull swap
        uint128 availableSize;
        // 32 byte slot 5
        // Amount of biddingToken received
        // This figure is updated after each successfull swap
        uint256 totalSales;
    }

    struct Bid {
        // ID assigned to offers
        uint256 swapId;
        // Number only used once for each wallet
        uint256 nonce;
        // Signer wallet address
        address signerWallet;
        // Amount of biddingToken offered by signer
        uint256 sellAmount;
        // Amount of oToken requested by signer
        uint256 buyAmount;
        // Referrer wallet address
        address referrer;
        // Signature recovery id
        uint8 v;
        // r portion of the ECSDA signature
        bytes32 r;
        // s portion of the ECSDA signature
        bytes32 s;
    }

    struct OfferDetails {
        // Seller wallet address
        address seller;
        // Addess of oToken
        address oToken;
        // Price per oToken denominated in biddingToken
        uint256 minPrice;
        // ERC20 Token to bid for oToken
        address biddingToken;
        // Minimum oToken amount acceptable for a single bid
        uint256 minBidSize;
    }

    event Swap(
        uint256 indexed swapId,
        uint256 nonce,
        address indexed signerWallet,
        uint256 signerAmount,
        uint256 sellerAmount,
        address referrer,
        uint256 feeAmount
    );

    event NewOffer(
        uint256 swapId,
        address seller,
        address oToken,
        address biddingToken,
        uint256 minPrice,
        uint256 minBidSize,
        uint256 totalSize
    );

    event SetFee(address referrer, uint256 fee);

    event SettleOffer(uint256 swapId);

    event Cancel(uint256 indexed nonce, address indexed signerWallet);

    event Authorize(address indexed signer, address indexed signerWallet);

    event Revoke(address indexed signer, address indexed signerWallet);

    function createOffer(
        address oToken,
        address biddingToken,
        uint96 minPrice,
        uint96 minBidSize,
        uint128 totalSize
    ) external returns (uint256 swapId);

    function settleOffer(uint256 swapId, Bid[] calldata bids) external;

    function cancelNonce(uint256[] calldata nonces) external;

    function check(Bid calldata bid)
        external
        view
        returns (uint256, bytes32[] memory);

    function averagePriceForOffer(uint256 swapId)
        external
        view
        returns (uint256);

    function authorize(address sender) external;

    function revoke() external;

    function nonceUsed(address, uint256) external view returns (bool);
}
