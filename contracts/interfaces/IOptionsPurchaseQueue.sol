// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface IOptionsPurchaseQueue {
    function totalOptionsAmount(address) external view returns (uint256);

    function vaultAllocatedOptions(address) external view returns (uint256);

    function whitelistedBuyer(address) external view returns (bool);

    function minPurchaseAmount(address) external view returns (uint256);

    function ceilingPrice(address) external view returns (uint256);

    function getPremiums(address vault, uint256 optionsAmount)
        external
        view
        returns (uint256);

    function requestPurchase(address vault, uint256 optionsAmount)
        external
        returns (uint256);

    function allocateOptions(uint256 allocatedOptions)
        external
        returns (uint256);

    function sellToBuyers(uint256 settlementPrice) external returns (uint256);

    function whitelistBuyer(address buyer) external;

    function blacklistBuyer(address buyer) external;

    function setCeilingPrice(address vault, uint256 price) external;

    function setMinPurchaseAmount(address vault, uint256 amount) external;
}
