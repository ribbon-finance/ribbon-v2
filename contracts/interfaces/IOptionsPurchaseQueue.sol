// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface IOptionsPurchaseQueue {
    function totalOptionsAmount(address) external view returns (uint256);

    function vaultAllocatedOptions(address) external view returns (uint256);

    function whitelistedBuyer(address) external view returns (bool);

    function ceilingPrice(address) external view returns (uint256);

    function getPremiums(address vault, uint256 optionsAmount)
        external
        view
        returns (uint256);

    function getOptionsSettlementPrice(address vault)
        external
        view
        returns (uint256);

    function requestPurchase(address vault, uint256 optionsAmount)
        external
        returns (uint256);

    function allocateOptions(uint256 allocatedOptions)
        external
        returns (uint256);

    function sellToBuyers() external returns (uint256);

    function whitelistBuyer(address buyer) external;

    function blacklistBuyer(address buyer) external;

    function setCeilingPrice(address vault, uint256 price) external;
}
