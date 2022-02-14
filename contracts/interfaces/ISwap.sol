// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

interface ISwap {

  struct Offer {
    address seller;
    address offeredToken;
    address biddingToken;
    uint256 minPrice;
    uint256 minBidSize;
    uint256 totalSize;
    uint256 availableSize;
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
    uint256 indexed nonce,
    uint256 timestamp,
    address indexed signerWallet,
    address signerToken,
    uint256 signerAmount,
    address indexed senderWallet,
    address senderToken,
    uint256 senderAmount
  );

  event NewSwapOffer(
    uint256 swapId,
    address seller,
    address offeredToken,
    address biddingToken,
    uint256 minPrice,
    uint256 minBidSize,
    uint256 totalSize
  );

  event Cancel(uint256 indexed nonce, address indexed signerWallet);

  event Authorize(address indexed signer, address indexed signerWallet);

  event Revoke(address indexed signer, address indexed signerWallet);

  function cancel(uint256[] calldata nonces) external;

  function nonceUsed(address, uint256) external view returns (bool);

  function authorized(address) external view returns (address);
}