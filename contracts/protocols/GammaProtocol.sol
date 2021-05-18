// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";

import {
    IOtokenFactory,
    OtokenInterface,
    IController,
    OracleInterface,
    GammaTypes
} from "../interfaces/GammaInterface.sol";

contract GammaProtocol {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // gammaController is the top-level contract in Gamma protocol
    // which allows users to perform multiple actions on their vaults
    // and positions https://github.com/opynfinance/GammaProtocol/blob/master/contracts/Controller.sol
    IController public immutable GAMMA_CONTROLLER;

    // oTokenFactory is the factory contract used to spawn otokens. Used to lookup otokens.
    address public immutable OTOKEN_FACTORY;

    // MARGIN_POOL is Gamma protocol's collateral pool.
    // Needed to approve collateral.safeTransferFrom for minting otokens.
    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/MarginPool.sol
    address public immutable MARGIN_POOL;

    function createShort(address oToken, uint256 depositAmount)
        external
        returns (uint256)
    {
        IController controller = IController(gammaController);
        uint256 newVaultID =
            (controller.getAccountVaultCounter(address(this))).add(1);

        address collateralAsset = oToken.collateralAsset();
        IERC20Detailed collateralToken = IERC20Detailed(collateralAsset);

        uint256 collateralDecimals = uint256(collateralToken.decimals());
        uint256 mintAmount;

        if (optionTerms.optionType == ProtocolAdapterTypes.OptionType.Call) {
            mintAmount = depositAmount;
            uint256 scaleBy = 10**(collateralDecimals.sub(8)); // oTokens have 8 decimals

            if (mintAmount > scaleBy && collateralDecimals > 8) {
                mintAmount = depositAmount.div(scaleBy); // scale down from 10**18 to 10**8
                require(
                    mintAmount > 0,
                    "Must deposit more than 10**8 collateral"
                );
            }
        } else {
            // For minting puts, there will be instances where the full depositAmount will not be used for minting.
            // This is because of an issue with precision.
            //
            // For ETH put options, we are calculating the mintAmount (10**8 decimals) using
            // the depositAmount (10**18 decimals), which will result in truncation of decimals when scaling down.
            // As a result, there will be tiny amounts of dust left behind in the Opyn vault when minting put otokens.
            //
            // For simplicity's sake, we do not refund the dust back to the address(this) on minting otokens.
            // We retain the dust in the vault so the calling contract can withdraw the
            // actual locked amount + dust at settlement.
            //
            // To test this behavior, we can console.log
            // MarginCalculatorInterface(0x7A48d10f372b3D7c60f6c9770B91398e4ccfd3C7).getExcessCollateral(vault)
            // to see how much dust (or excess collateral) is left behind.
            mintAmount = wdiv(
                depositAmount.mul(OTOKEN_DECIMALS),
                optionTerms
                    .strikePrice
            )
                .div(10**collateralDecimals);
        }

        // double approve to fix non-compliant ERC20s
        collateralToken.safeApprove(MARGIN_POOL, 0);
        collateralToken.safeApprove(MARGIN_POOL, depositAmount);

        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](3);

        actions[0] = IController.ActionArgs(
            IController.ActionType.OpenVault,
            address(this), // owner
            address(this), // receiver -  we need this contract to receive so we can swap at the end
            address(0), // asset, otoken
            newVaultID, // vaultId
            0, // amount
            0, //index
            "" //data
        );

        actions[1] = IController.ActionArgs(
            IController.ActionType.DepositCollateral,
            address(this), // owner
            address(this), // address to transfer from
            collateralAsset, // deposited asset
            newVaultID, // vaultId
            depositAmount, // amount
            0, //index
            "" //data
        );

        actions[2] = IController.ActionArgs(
            IController.ActionType.MintShortOption,
            address(this), // owner
            address(this), // address to transfer to
            oToken, // deposited asset
            newVaultID, // vaultId
            mintAmount, // amount
            0, //index
            "" //data
        );

        controller.operate(actions);

        return mintAmount;
    }

    /**
     * @notice Close the existing short otoken position. Currently this implementation is simple.
     * It closes the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time. Since calling `closeShort` deletes vaults,
     * this assumption should hold.
     */
    function settleShort() external returns (uint256) {
        IController controller = IController(gammaController);

        // gets the currently active vault ID
        uint256 vaultID = controller.getAccountVaultCounter(address(this));

        GammaTypes.Vault memory vault =
            controller.getVault(address(this), vaultID);

        require(vault.shortOtokens.length > 0, "No active short");

        IERC20 collateralToken = IERC20(vault.collateralAssets[0]);
        OtokenInterface otoken = OtokenInterface(vault.shortOtokens[0]);

        uint256 startCollateralBalance =
            collateralToken.balanceOf(address(this));

        IController.ActionArgs[] memory actions;

        // If it is after expiry, we need to settle the short position using the normal way
        // Delete the vault and withdraw all remaining collateral from the vault
        //
        // If it is before expiry, we need to burn otokens in order to withdraw collateral from the vault
        actions = new IController.ActionArgs[](1);

        actions[0] = IController.ActionArgs(
            IController.ActionType.SettleVault,
            address(this), // owner
            address(this), // address to transfer to
            address(0), // not used
            vaultID, // vaultId
            0, // not used
            0, // not used
            "" // not used
        );

        controller.operate(actions);

        uint256 endCollateralBalance = collateralToken.balanceOf(address(this));

        return endCollateralBalance.sub(startCollateralBalance);
    }

    function closeShortBeforeExpiry() external {
        // Burning otokens given by vault.shortAmounts[0] (closing the entire short position),
        // then withdrawing all the collateral from the vault
        actions = new IController.ActionArgs[](2);

        actions[0] = IController.ActionArgs(
            IController.ActionType.BurnShortOption,
            address(this), // owner
            address(this), // address to transfer to
            address(otoken), // otoken address
            vaultID, // vaultId
            vault.shortAmounts[0], // amount
            0, //index
            "" //data
        );

        actions[1] = IController.ActionArgs(
            IController.ActionType.WithdrawCollateral,
            address(this), // owner
            address(this), // address to transfer to
            address(collateralToken), // withdrawn asset
            vaultID, // vaultId
            vault.collateralAmounts[0], // amount
            0, //index
            "" //data
        );

        controller.operate(actions);
    }
}
