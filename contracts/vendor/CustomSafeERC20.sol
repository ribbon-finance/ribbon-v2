// SPDX-License-Identifier: MIT
pragma solidity ^0.7.3;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SafeERC20
 * @dev Wrappers around ERC20 operations that throw on failure.
 * To use this library you can add a `using SafeERC20 for ERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
  function safeTransfer(IERC20 token, address to, uint256 value) internal {
      require(_callOptionalReturn(token, abi.encodeWithSelector(token.transfer.selector, to, value)),
          "ERC20 transfer failed");
  }

  function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
      require(_callOptionalReturn(token, abi.encodeWithSelector(token.transferFrom.selector, from, to, value)),
          "ERC20 transferFrom failed");
  }

  function safeApprove(IERC20 token, address spender, uint256 value) internal {
    if (_callOptionalReturn(token, abi.encodeWithSelector(token.approve.selector, spender, value))) {
        return;
    }
    require(_callOptionalReturn(token, abi.encodeWithSelector(token.approve.selector, spender, 0))
        && _callOptionalReturn(token, abi.encodeWithSelector(token.approve.selector, spender, value)),
        "ERC20 approve failed");
  }

  function _callOptionalReturn(IERC20 token, bytes memory data) private returns (bool) {
      // solhint-disable-next-line avoid-low-level-calls
      (bool success, bytes memory returndata) = address(token).call(data);
      if (!success) {
          return false;
      }

      if (returndata.length >= 32) { // Return data is optional
          return abi.decode(returndata, (bool));
      }

      // In a wierd case when return data is 1-31 bytes long - return false.
      return returndata.length == 0;
  }
}
