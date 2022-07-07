// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

abstract contract SwapStorageV1 {
    // Counter to keep track number of offers
    uint256 public offersCounter;
    // Mapping of swap offer details for a given swapId
    mapping(uint256 => Offer) public swapOffers;
    // Mapping of referral fees for a given address
    mapping(address => uint256) public referralFees;
    // Mapping of authorized delegate for a given address
    mapping(address => address) public authorized;
    /**
     * @notice Double mapping of signers to nonce groups to nonce states
     * @dev The nonce group is computed as nonce / 256, so each group of 256 sequential nonces uses the same key
     * @dev The nonce states are encoded as 256 bits, for each nonce in the group 0 means available and 1 means used
     */
    mapping(address => mapping(uint256 => uint256)) internal _nonceGroups;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of SwapStorage
// e.g. SwapStorage<versionNumber>, so finally it would look like
// contract SwapStorage is SwapStorageV1, SwapStorageV2
abstract contract SwapStorage is
    SwapStorageV1,
{

}
