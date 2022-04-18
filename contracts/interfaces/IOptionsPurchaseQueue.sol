// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0;

interface IOptionsPurchaseQueue {
    /**
     * @dev Contains purchase request info
     * @param optionsAmount Amount of options to purchase
     * @param premiums Total premiums the buyer is spending to purchase the options (optionsAmount * ceilingPrice)
     *  We need to track the premiums here since the ceilingPrice could change between the time the purchase was
     *  requested and when the options are sold
     * @param buyer The buyer requesting this purchase
     */
    struct Purchase {
        uint128 optionsAmount; // Slot 0
        uint128 premiums;
        address buyer; // Slot 1
    }

    function purchases(address, uint256)
        external
        view
        returns (
            uint128,
            uint128,
            address
        );

    function totalOptionsAmount(address) external view returns (uint256);

    function vaultAllocatedOptions(address) external view returns (uint256);

    function whitelistedBuyer(address) external view returns (bool);

    function minPurchaseAmount(address) external view returns (uint256);

    function ceilingPrice(address) external view returns (uint256);

    function getPurchases(address vault)
        external
        view
        returns (Purchase[] memory);

    function getPremiums(address vault, uint256 optionsAmount)
        external
        view
        returns (uint256);

    function getOptionsAllocation(address vault, uint256 allocatedOptions)
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

    function cancelAllPurchases(address vault) external;

    function addWhitelist(address buyer) external;

    function removeWhitelist(address buyer) external;

    function setCeilingPrice(address vault, uint256 price) external;

    function setMinPurchaseAmount(address vault, uint256 amount) external;
}
