// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

import {SafeMath} from "@openzeppelin/contracts/utils/math/SafeMath.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

library VaultLib {
    using SafeMath for uint256;
    using SafeCast for uint256;

    uint256 constant ONE_ONE = 1e36;

    // the collateralization ratio (CR) is checked with the numerator and denominator separately
    // a user is safe if - collateral value >= (COLLAT_RATIO_NUMER/COLLAT_RATIO_DENOM)* debt value
    uint256 public constant CR_NUMERATOR = 3;
    uint256 public constant CR_DENOMINATOR = 2;

    struct Vault {
        // the address that can update the vault
        address operator;
        // uniswap position token id deposited into the vault as collateral
        // 2^32 is 4,294,967,296, which means the vault structure will work with up to 4 billion positions
        uint32 NftCollateralId;
        // amount of eth (wei) used in the vault as collateral
        // 2^96 / 1e18 = 79,228,162,514, which means a vault can store up to 79 billion eth
        // when we need to do calculations, we always cast this number to uint256 to avoid overflow
        uint96 collateralAmount;
        // amount of wPowerPerp minted from the vault
        uint128 shortAmount;
    }

    /**
     * @notice add eth collateral to a vault
     * @param _vault in-memory vault
     * @param _amount amount of eth to add
     */
    function addEthCollateral(Vault memory _vault, uint256 _amount)
        internal
        pure
    {
        _vault.collateralAmount = uint256(_vault.collateralAmount)
            .add(_amount)
            .toUint96();
    }

    /**
     * @notice add uniswap position token collateral to a vault
     * @param _vault in-memory vault
     * @param _tokenId uniswap position token id
     */
    function addUniNftCollateral(Vault memory _vault, uint256 _tokenId)
        internal
        pure
    {
        require(_vault.NftCollateralId == 0, "V1");
        require(_tokenId != 0, "C23");
        _vault.NftCollateralId = _tokenId.toUint32();
    }

    /**
     * @notice remove eth collateral from a vault
     * @param _vault in-memory vault
     * @param _amount amount of eth to remove
     */
    function removeEthCollateral(Vault memory _vault, uint256 _amount)
        internal
        pure
    {
        _vault.collateralAmount = uint256(_vault.collateralAmount)
            .sub(_amount)
            .toUint96();
    }

    /**
     * @notice remove uniswap position token collateral from a vault
     * @param _vault in-memory vault
     */
    function removeUniNftCollateral(Vault memory _vault) internal pure {
        require(_vault.NftCollateralId != 0, "V2");
        _vault.NftCollateralId = 0;
    }

    /**
     * @notice add debt to vault
     * @param _vault in-memory vault
     * @param _amount amount of debt to add
     */
    function addShort(Vault memory _vault, uint256 _amount) internal pure {
        _vault.shortAmount = uint256(_vault.shortAmount)
            .add(_amount)
            .toUint128();
    }

    /**
     * @notice remove debt from vault
     * @param _vault in-memory vault
     * @param _amount amount of debt to remove
     */
    function removeShort(Vault memory _vault, uint256 _amount) internal pure {
        _vault.shortAmount = uint256(_vault.shortAmount)
            .sub(_amount)
            .toUint128();
    }

    /**
     * @notice check if a vault is properly collateralized
     * @param _vault the vault we want to check
     * @param _positionManager address of the uniswap position manager
     * @param _normalizationFactor current _normalizationFactor
     * @param _ethQuoteCurrencyPrice current eth price scaled by 1e18
     * @param _minCollateral minimum collateral that needs to be in a vault
     * @param _wsqueethPoolTick current price tick for wsqueeth pool
     * @param _isWethToken0 whether weth is token0 in the wsqueeth pool
     * @return true if the vault is sufficiently collateralized
     * @return true if the vault is considered as a dust vault
     */
    function getVaultStatus(
        Vault memory _vault,
        address _positionManager,
        uint256 _normalizationFactor,
        uint256 _ethQuoteCurrencyPrice,
        uint256 _minCollateral,
        int24 _wsqueethPoolTick,
        bool _isWethToken0
    ) internal view returns (bool, bool) {
        if (_vault.shortAmount == 0) return (true, false);

        uint256 debtValueInETH = uint256(_vault.shortAmount)
            .mul(_normalizationFactor)
            .mul(_ethQuoteCurrencyPrice)
            .div(ONE_ONE);
        uint256 totalCollateral = _getEffectiveCollateral(
            _vault,
            _positionManager,
            _normalizationFactor,
            _ethQuoteCurrencyPrice,
            _wsqueethPoolTick,
            _isWethToken0
        );

        bool isDust = totalCollateral < _minCollateral;
        bool isAboveWater = totalCollateral.mul(CR_DENOMINATOR) >=
            debtValueInETH.mul(CR_NUMERATOR);
        return (isAboveWater, isDust);
    }

    /**
     * @notice get the total effective collateral of a vault, which is:
     *         collateral amount + uniswap position token equivelent amount in eth
     * @param _vault the vault we want to check
     * @param _positionManager address of the uniswap position manager
     * @param _normalizationFactor current _normalizationFactor
     * @param _ethQuoteCurrencyPrice current eth price scaled by 1e18
     * @param _wsqueethPoolTick current price tick for wsqueeth pool
     * @param _isWethToken0 whether weth is token0 in the wsqueeth pool
     * @return the total worth of collateral in the vault
     */
    function _getEffectiveCollateral(
        Vault memory _vault,
        address _positionManager,
        uint256 _normalizationFactor,
        uint256 _ethQuoteCurrencyPrice,
        int24 _wsqueethPoolTick,
        bool _isWethToken0
    ) internal view returns (uint256) {
        // TODO: FIX
        return 0;
    }
}
