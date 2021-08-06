// SPDX-License-Identifier: MIT
pragma solidity >=0.7.2;

interface ICRV {
    function get_dy(
        uint256 _indexIn,
        uint256 _indexOut,
        uint256 _amountIn
    ) external view returns (uint256);

    // https://github.com/curvefi/curve-contract/blob/
    // b0bbf77f8f93c9c5f4e415bce9cd71f0cdee960e/contracts/pools/steth/StableSwapSTETH.vy#L431
    function exchange(
        uint256 _indexIn,
        uint256 _indexOut,
        uint256 _amountIn,
        uint256 _minAmountOut
    ) external returns (uint256);
}
