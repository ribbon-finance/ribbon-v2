// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ISwap {
    struct Offer {
        address seller;
        address offeredToken;
        address biddingToken;
        bool isOpen;
        uint128 minPrice;
        uint128 minBidSize;
        uint128 totalSize;
        uint128 availableSize;
    }

    struct Bid {
        uint256 swapId;
        uint256 nonce;
        address signerWallet;
        uint256 sellAmount;
        uint256 buyAmount;
        address referrer;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    event Swap(
        uint256 indexed swapId,
        uint256 nonce,
        address indexed signerWallet,
        uint256 signerAmount,
        address indexed senderWallet,
        uint256 senderAmount,
        address referrer,
        uint256 feeAmount
    );

    event NewOffer(
        uint256 swapId,
        address seller,
        address offeredToken,
        address biddingToken,
        uint256 minPrice,
        uint256 minBidSize,
        uint256 totalSize
    );

    event CloseOffer(uint256 swapId);

    event SettleOffer(uint256 swapId);

    event Cancel(uint256 indexed nonce, address indexed signerWallet);

    function createOffer(
        address offeredToken,
        address biddingToken,
        uint128 minPrice,
        uint128 minBidSize,
        uint128 totalSize
    ) external returns (uint256 swapId);

    function settleOffer(uint256 swapId, Bid[] calldata bids) external;

    function closeOffer(uint256 swapId) external;

    function cancelNonce(uint256[] calldata nonces) external;

    function nonceUsed(address, uint256) external view returns (bool);
}
