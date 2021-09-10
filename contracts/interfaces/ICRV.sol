// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface ICRV {
    function get_dy(
        int128 _indexIn,
        int128 _indexOut,
        uint256 _amountIn
    ) external view returns (uint256);

    // https://github.com/curvefi/curve-contract/blob/
    // b0bbf77f8f93c9c5f4e415bce9cd71f0cdee960e/contracts/pools/steth/StableSwapSTETH.vy#L431
    function exchange(
        int128 _indexIn,
        int128 _indexOut,
        uint256 _amountIn,
        uint256 _minAmountOut
    ) external returns (uint256);
}
