// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
pragma experimental ABIEncoderV2;

import {SafeMath} from "@openzeppelin/contracts/math/SafeMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import {
    IOtokenFactory,
    IOtoken,
    IController,
    GammaTypes
} from "../interfaces/GammaInterface.sol";
import {IERC20Detailed} from "../interfaces/IERC20Detailed.sol";
import {DSMath} from "../lib/DSMath.sol";

contract GammaProtocol is DSMath {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/Otoken.sol#L70
    uint256 private constant OTOKEN_DECIMALS = 10**8;

    // GAMMA_CONTROLLER is the top-level contract in Gamma protocol
    // which allows users to perform multiple actions on their vaults
    // and positions https://github.com/opynfinance/GammaProtocol/blob/master/contracts/Controller.sol
    IController public immutable GAMMA_CONTROLLER;

    // oTokenFactory is the factory contract used to spawn otokens. Used to lookup otokens.
    IOtokenFactory public immutable OTOKEN_FACTORY;

    // MARGIN_POOL is Gamma protocol's collateral pool.
    // Needed to approve collateral.safeTransferFrom for minting otokens.
    // https://github.com/opynfinance/GammaProtocol/blob/master/contracts/MarginPool.sol
    address public immutable MARGIN_POOL;

    constructor(
        address _oTokenFactory,
        address _gammaController,
        address _marginPool
    ) {
        require(_oTokenFactory != address(0), "!_oTokenFactory");
        require(_gammaController != address(0), "!_gammaController");
        require(_marginPool != address(0), "!_marginPool");

        OTOKEN_FACTORY = IOtokenFactory(_oTokenFactory);
        GAMMA_CONTROLLER = IController(_gammaController);
        MARGIN_POOL = _marginPool;
    }

    function _createShort(address oTokenAddress, uint256 depositAmount)
        internal
        returns (uint256)
    {
        IController controller = IController(GAMMA_CONTROLLER);
        uint256 newVaultID =
            (controller.getAccountVaultCounter(address(this))).add(1);

        IOtoken oToken = IOtoken(oTokenAddress);
        uint256 strikePrice = oToken.strikePrice();
        bool isPut = oToken.isPut();
        address collateralAsset = oToken.collateralAsset();
        IERC20 collateralToken = IERC20(collateralAsset);

        uint256 collateralDecimals =
            uint256(IERC20Detailed(collateralAsset).decimals());
        uint256 mintAmount;

        if (isPut) {
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
            mintAmount = wdiv(depositAmount.mul(OTOKEN_DECIMALS), strikePrice)
                .div(10**collateralDecimals);
        } else {
            mintAmount = depositAmount;
            uint256 scaleBy = 10**(collateralDecimals.sub(8)); // oTokens have 8 decimals

            if (mintAmount > scaleBy && collateralDecimals > 8) {
                mintAmount = depositAmount.div(scaleBy); // scale down from 10**18 to 10**8
                require(
                    mintAmount > 0,
                    "Must deposit more than 10**8 collateral"
                );
            }
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
            oTokenAddress, // deposited asset
            newVaultID, // vaultId
            mintAmount, // amount
            0, //index
            "" //data
        );

        GAMMA_CONTROLLER.operate(actions);

        return mintAmount;
    }

    /**
     * @notice Close the existing short otoken position. Currently this implementation is simple.
     * It closes the most recent vault opened by the contract. This assumes that the contract will
     * only have a single vault open at any given time. Since calling `closeShort` deletes vaults,
     * this assumption should hold.
     */
    function _settleShort() internal returns (uint256) {
        // gets the currently active vault ID
        uint256 vaultID =
            GAMMA_CONTROLLER.getAccountVaultCounter(address(this));

        GammaTypes.Vault memory vault =
            GAMMA_CONTROLLER.getVault(address(this), vaultID);

        require(vault.shortOtokens.length > 0, "No active short");

        IERC20 collateralToken = IERC20(vault.collateralAssets[0]);

        uint256 startCollateralBalance =
            collateralToken.balanceOf(address(this));

        // If it is after expiry, we need to settle the short position using the normal way
        // Delete the vault and withdraw all remaining collateral from the vault
        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](1);

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

        GAMMA_CONTROLLER.operate(actions);

        uint256 endCollateralBalance = collateralToken.balanceOf(address(this));

        return endCollateralBalance.sub(startCollateralBalance);
    }

    function _closeShortBeforeExpiry() internal {
        // gets the currently active vault ID
        uint256 vaultID =
            GAMMA_CONTROLLER.getAccountVaultCounter(address(this));

        GammaTypes.Vault memory vault =
            GAMMA_CONTROLLER.getVault(address(this), vaultID);

        // Burning otokens given by vault.shortAmounts[0] (closing the entire short position),
        // then withdrawing all the collateral from the vault
        IController.ActionArgs[] memory actions =
            new IController.ActionArgs[](2);

        address collateral = vault.collateralAssets[0];
        address otoken = vault.shortOtokens[0];

        // If it is before expiry, we need to burn otokens in order to withdraw collateral from the vault
        actions[0] = IController.ActionArgs(
            IController.ActionType.BurnShortOption,
            address(this), // owner
            address(this), // address to transfer to
            otoken, // otoken address
            vaultID, // vaultId
            vault.shortAmounts[0], // amount
            0, //index
            "" //data
        );

        actions[1] = IController.ActionArgs(
            IController.ActionType.WithdrawCollateral,
            address(this), // owner
            address(this), // address to transfer to
            collateral, // withdrawn asset
            vaultID, // vaultId
            vault.collateralAmounts[0], // amount
            0, //index
            "" //data
        );

        GAMMA_CONTROLLER.operate(actions);
    }
}
