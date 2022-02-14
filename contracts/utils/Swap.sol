// SPDX-License-Identifier: MIT
// Source: https://github.com/airswap/airswap-protocols/blob/main/source/swap/contracts/Swap.sol

/* solhint-disable var-name-mixedcase */
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "../interfaces/ISwap.sol";
import { IERC20Detailed } from "../interfaces/IERC20Detailed.sol";
import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";

/**
 * @title AirSwap: Atomic Token Swap
 * @notice https://www.airswap.io/
 */
contract Swap is ISwap, Ownable {
  using SafeMath for uint256;
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

  bytes32 public constant ORDER_TYPEHASH =
    keccak256(
      abi.encodePacked(
        "Order(",
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

  // Max. percentage with 2 decimals
  uint256 internal constant FEE_MULTIPLIER = 100;
  uint256 internal constant MAX_PERCENTAGE = 100 * FEE_MULTIPLIER;
  
  address public keeper;
  uint256 public offersCounter = 0;

  uint256 internal constant MAX_ERROR_COUNT = 6;

  /**
   * @notice Double mapping of signers to nonce groups to nonce states
   * @dev The nonce group is computed as nonce / 256, so each group of 256 sequential nonces uses the same key
   * @dev The nonce states are encoded as 256 bits, for each nonce in the group 0 means available and 1 means used
   */
  mapping(address => mapping(uint256 => uint256)) internal _nonceGroups;

  mapping(address => address) public override authorized;

  mapping(uint256 => Offer) public swapOffers;

  mapping(address => uint256) public referralFees;

  constructor(
    address _keeper
  ) {

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

    require(_keeper != address(0), "!_keeper");
    keeper = _keeper;
  }

  /**
   * @dev Throws if called by any account other than the keeper.
   */
  modifier onlyKeeper() {
      require(msg.sender == keeper, "!keeper");
      _;
  }

  /**
   * @notice Sets the new keeper
   * @param newKeeper is the address of the new keeper
   */
  function setNewKeeper(address newKeeper) external onlyOwner {
      require(newKeeper != address(0), "!newKeeper");
      keeper = newKeeper;
  }

  /**
   * @notice Sets the referral fee for a specific referrer
   * @param referrer is the address of the referrer
   * @param fee is the fee in percent in 2 decimals
   */
  function setFee(address referrer, uint256 fee) external onlyOwner {
      require(referrer != address(0), "!referrer");
      require(fee >= 0, "Fee less than 0");
      require(fee < MAX_PERCENTAGE, "Fee more than 100%");
      
      referralFees[referrer] = fee;
  }

  /**
   * @notice Create a new offer available for swap
   * @param offeredToken token offered by seller
   * @param biddingToken token asked by seller
   * @param minPrice minimum price of offeredToken in terms of biddingToken
   * @param minBidSize minimum size allowed in terms of biddingToken
   * @param totalSize amount of offeredToken offered by seller
   */
  function createNewOffering(
    address offeredToken,
    address biddingToken,
    uint256 minPrice,
    uint256 minBidSize,
    uint256 totalSize
  ) external returns (uint256 swapId) {
    require(offeredToken != address(0), "!offeredToken");
    require(biddingToken != address(0), "!biddingToken");
    require(minPrice > 0, "!minPrice");
    require(minBidSize > 0, "!minBidSize");
    require(totalSize > 0, "!size");

    offersCounter += 1;

    swapId = offersCounter;

    swapOffers[swapId] = Offer({
      seller: msg.sender,
      offeredToken: offeredToken,
      biddingToken: biddingToken,
      minBidSize: minBidSize,
      minPrice: minPrice,
      totalSize: totalSize,
      availableSize: totalSize
    });

    emit NewSwapOffer(
      swapId, 
      msg.sender, 
      offeredToken, 
      biddingToken, 
      minPrice, 
      minBidSize,
      totalSize
    );
  }

  /**
   * @notice Atomic ERC20 Swap
   * @param offer offer information
   * @param swapId unique identifier of the offering
   * @param nonce uint256 Unique and should be sequential
   * @param signerWallet address Wallet of the signer
   * @param sellAmount token offered by signer
   * @param buyAmount token requested by the signer
   * @param v uint8 "v" value of the ECDSA signature
   * @param r bytes32 "r" value of the ECDSA signature
   * @param s bytes32 "s" value of the ECDSA signature
   */
  function swap(
    Offer storage offer,
    uint256 swapId,
    uint256 nonce,
    address signerWallet,
    uint256 sellAmount,
    uint256 buyAmount,
    address referrer,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) internal {
    // Ensure the order is valid
    _checkValidOrder(
      swapId,
      nonce,
      signerWallet,
      sellAmount,
      buyAmount,
      referrer,
      v,
      r,
      s
    );

    // Transfer token from sender to signer
    IERC20(offer.offeredToken).safeTransferFrom(
      offer.seller,
      signerWallet,
      buyAmount
    );

    // Transfer to referrer if any
    uint256 feeAmount;
    uint256 feePercent = referralFees[referrer];
    if (feePercent > 0) {
      feeAmount = sellAmount.mul(feePercent).div(FEE_MULTIPLIER);

      IERC20(offer.biddingToken).safeTransferFrom(
        signerWallet, 
        referrer, 
        feeAmount
      );
    }

    // Transfer token from signer to recipient
    IERC20(offer.biddingToken).safeTransferFrom(
      signerWallet, 
      offer.seller, 
      sellAmount.sub(feeAmount)
    );

    // Emit a Swap event
    emit Swap(
      nonce,
      block.timestamp,
      signerWallet,
      offer.biddingToken,
      sellAmount,
      offer.seller,
      offer.offeredToken,
      buyAmount
    );
  }

  /**
   * @notice Settles the swap offering by iterating through the bids
   * @param swapId unique identifier of the offering
   * @param bids bids for swaps
   */
  function settle(
    uint256 swapId,
    Bid[] calldata bids
  ) external onlyKeeper {
    Offer storage offer = swapOffers[swapId];

    uint256 offeredTokenDecimals = IERC20Detailed(offer.offeredToken).decimals();

    for (uint256 i = 0; i < bids.length; i++) {
      // Check min. size
      require(bids[i].buyAmount > offer.minBidSize, "Min. bid size not met");

      uint256 bidPrice = bids[i].sellAmount.mul(offeredTokenDecimals)
                            .div(bids[i].buyAmount);

      // Check min. bid
      require(bidPrice >= offer.minPrice, "Min. price not met");
      
      // Check if there is still remaining size, prevent swap with 0 allocation
      require(offer.availableSize > 0, "Bid exceeds available size");

      // Partial fill
      uint256 buyAmount = bids[i].buyAmount <= offer.availableSize
        ? bids[i].buyAmount
        : offer.availableSize;
      
      // Swap has in-built check for order validity
      swap (
        offer,
        swapId,
        bids[i].nonce,
        bids[i].signerWallet,
        bids[i].sellAmount,
        buyAmount,
        bids[i].referrer,
        bids[i].v,
        bids[i].r,
        bids[i].s
      );

      // Update offer
      offer.availableSize -= bids[i].buyAmount;
    }
  }

  /**
   * @notice Swap Atomic ERC20 Swap (Low Gas Usage)
   * @param offer offer information
   * @param swapId unique identifier of the offering
   * @param nonce uint256 Unique and should be sequential
   * @param signerWallet address Wallet of the signer
   * @param sellAmount token offered by signer
   * @param buyAmount token requested by the signer
   * @param v uint8 "v" value of the ECDSA signature
   * @param r bytes32 "r" value of the ECDSA signature
   * @param s bytes32 "s" value of the ECDSA signature
   */
  function light(
    Offer storage offer,
    uint256 swapId,
    uint256 nonce,
    address signerWallet,
    uint256 sellAmount,
    uint256 buyAmount,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) internal {
    require(DOMAIN_CHAIN_ID == getChainId(), "CHAIN_ID_CHANGED");

    // Recover the signatory from the hash and signature
    address signatory = ecrecover(
      keccak256(
        abi.encodePacked(
          "\x19\x01",
          DOMAIN_SEPARATOR,
          keccak256(
            abi.encode(
              ORDER_TYPEHASH,
              swapId,
              nonce,
              signerWallet,
              sellAmount,
              buyAmount
            )
          )
        )
      ),
      v,
      r,
      s
    );

    // Ensure the signatory is not null
    require(signatory != address(0), "SIGNATURE_INVALID");

    // Ensure the nonce is not yet used and if not mark it used
    require(_markNonceAsUsed(signatory, nonce), "NONCE_ALREADY_USED");

    // Ensure the signatory is authorized by the signer wallet
    if (signerWallet != signatory) {
      require(authorized[signerWallet] == signatory, "UNAUTHORIZED");
    }

    // Transfer token from sender to signer
    IERC20(offer.offeredToken).safeTransferFrom(
      offer.seller,
      signerWallet,
      buyAmount
    );

    // Transfer token from signer to recipient
    IERC20(offer.biddingToken).safeTransferFrom(
      signerWallet, 
      offer.seller, 
      sellAmount
    );

    // Emit a Swap event
    emit Swap(
      nonce,
      block.timestamp,
      signerWallet,
      offer.biddingToken,
      sellAmount,
      offer.seller,
      offer.offeredToken,
      buyAmount
    );
  }

  /**
   * @notice Cancel one or more nonces
   * @dev Cancelled nonces are marked as used
   * @dev Emits a Cancel event
   * @dev Out of gas may occur in arrays of length > 400
   * @param nonces uint256[] List of nonces to cancel
   */
  function cancel(uint256[] calldata nonces) external override {
    for (uint256 i = 0; i < nonces.length; i++) {
      uint256 nonce = nonces[i];
      if (_markNonceAsUsed(msg.sender, nonce)) {
        emit Cancel(nonce, msg.sender);
      }
    }
  }

  /**
   * @notice Validates Swap Order for any potential errors
   * @param swapId unique identifier of the offering
   * @param nonce uint256 Unique and should be sequential
   * @param signerWallet address Wallet of the signer
   * @param sellAmount token offered by signer
   * @param buyAmount token requested by the signer
   * @param v uint8 "v" value of the ECDSA signature
   * @param r bytes32 "r" value of the ECDSA signature
   * @param s bytes32 "s" value of the ECDSA signature
   * @return tuple of error count and bytes32[] memory array of error messages
   */
  function check(
    uint256 swapId,
    uint256 nonce,
    address signerWallet,
    uint256 sellAmount,
    uint256 buyAmount,
    address referrer,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) public view returns (uint256, bytes32[] memory) {
    Offer memory offer = swapOffers[swapId];
    require(offer.offeredToken != address(0), "Offer does not exist");

    bytes32[] memory errors = new bytes32[](MAX_ERROR_COUNT);
    Bid memory order;
    uint256 errCount;
    order.swapId = swapId;
    order.nonce = nonce;
    order.signerWallet = signerWallet;
    order.sellAmount = sellAmount;
    order.buyAmount = buyAmount;
    order.referrer = referrer;
    order.v = v;
    order.r = r;
    order.s = s;

    bytes32 hashed = _getOrderHash(
      order.swapId,
      order.nonce,
      order.signerWallet,
      order.sellAmount,
      order.buyAmount,
      order.referrer
    );

    address signatory = _getSignatory(hashed, order.v, order.r, order.s);

    if (signatory == address(0)) {
      errors[errCount] = "SIGNATURE_INVALID";
      errCount++;
    }

    if (
      order.signerWallet != signatory &&
      authorized[order.signerWallet] != signatory
    ) {
      errors[errCount] = "UNAUTHORIZED";
      errCount++;
    } else {
      if (nonceUsed(signatory, order.nonce)) {
        errors[errCount] = "NONCE_ALREADY_USED";
        errCount++;
      }
    }

    uint256 signerBalance = IERC20(offer.biddingToken).balanceOf(
      order.signerWallet
    );

    uint256 signerAllowance = IERC20(offer.biddingToken).allowance(
      order.signerWallet,
      address(this)
    );

    if (signerAllowance < order.sellAmount) {
      errors[errCount] = "SIGNER_ALLOWANCE_LOW";
      errCount++;
    }

    if (signerBalance < order.sellAmount) {
      errors[errCount] = "SIGNER_BALANCE_LOW";
      errCount++;
    }
    return (errCount, errors);
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

  /**
   * @notice Returns the current chainId using the chainid opcode
   * @return id uint256 The chain id
   */
  function getChainId() public view returns (uint256 id) {
    // no-inline-assembly
    assembly {
      id := chainid()
    }
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
   * @notice Checks Order Nonce, Signature
   * @param swapId unique identifier of the offering
   * @param nonce uint256 Unique and should be sequential
   * @param signerWallet address Wallet of the signer
   * @param sellAmount token offered by signer
   * @param buyAmount token requested by the signer
   * @param referrer referrer address
   * @param v uint8 "v" value of the ECDSA signature
   * @param r bytes32 "r" value of the ECDSA signature
   * @param s bytes32 "s" value of the ECDSA signature
   */
  function _checkValidOrder(
    uint256 swapId,
    uint256 nonce,
    address signerWallet,
    uint256 sellAmount,
    uint256 buyAmount,
    address referrer,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) internal {
    require(DOMAIN_CHAIN_ID == getChainId(), "CHAIN_ID_CHANGED");

    bytes32 hashed = _getOrderHash(
      swapId,
      nonce,
      signerWallet,
      sellAmount,
      buyAmount,
      referrer
    );

    // Recover the signatory from the hash and signature
    address signatory = _getSignatory(hashed, v, r, s);

    // Ensure the signatory is not null
    require(signatory != address(0), "SIGNATURE_INVALID");

    // Ensure the nonce is not yet used and if not mark it used
    require(_markNonceAsUsed(signatory, nonce), "NONCE_ALREADY_USED");

    // Ensure the signatory is authorized by the signer wallet
    if (signerWallet != signatory) {
      require(authorized[signerWallet] == signatory, "UNAUTHORIZED");
    }
  }

  /**
   * @notice Hash order parameters
   * @param swapId unique identifier of the offering
   * @param nonce uint256 Unique and should be sequential
   * @param signerWallet address Wallet of the signer
   * @param sellAmount token offered by signer
   * @param buyAmount token requested by the signer
   * @param referrer referrer address
   * @return bytes32
   */
  function _getOrderHash(
    uint256 swapId,
    uint256 nonce,
    address signerWallet,
    uint256 sellAmount,
    uint256 buyAmount,
    address referrer
  ) internal pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          ORDER_TYPEHASH,
          swapId,
          nonce,
          signerWallet,
          sellAmount,
          buyAmount,
          referrer
        )
      );
  }

  /**
   * @notice Recover the signatory from a signature
   * @param hash bytes32
   * @param v uint8
   * @param r bytes32
   * @param s bytes32
   */
  function _getSignatory(
    bytes32 hash,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) internal view returns (address) {
    return
      ecrecover(
        keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, hash)),
        v,
        r,
        s
      );
  }
}