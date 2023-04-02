// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {DigitalOption} from "../libraries/OptionType.sol";

abstract contract AutocallVaultStorageV1 {
  // State of current round's digital option (if DIP)
  DigitalOption public digitalOption;
  // Includes 2 decimals (i.e. 10500 = 105%)
  uint256 public autocallBarrierPCT;
  // Includes 2 decimals (i.e. 10500 = 105%)
  uint256 public couponBarrierPCT;
  // 1 day, 7 days, 1 month, etc in seconds
  uint256 public observationPeriodFreq;
  // Total num observation periods during epoch
  uint256 public numTotalObservationPeriods;
  // Seller of the autocall - they are the counterparty for the short vanilla put + digital put
  address public autocallSeller;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of RibbonAutocallVaultStorage
// e.g. RibbonAutocallVaultStorage<versionNumber>, so finally it would look like
// contract RibbonAutocallVaultStorage is RibbonAutocallVaultStorageV1, RibbonAutocallVaultStorageV2
abstract contract AutocallVaultStorage is AutocallVaultStorageV1{

}
