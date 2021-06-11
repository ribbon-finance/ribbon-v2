import { assert as _assert } from "chai";
import { BigNumber } from "ethers";

/**
 *  Convenience method to assert that two BN.js instances are equal.
 *  @param actualBN The BN.js instance you received
 *  @param expectedBN The BN.js amount you expected to receive
 *  @param context The description to log if we fail the assertion
 */
const assertBNEqual = (
  actualBN: BigNumber,
  expectedBN: BigNumber,
  context?: string
) => {
  _assert.strictEqual(actualBN.toString(), expectedBN.toString(), context);
};

/**
 *  Convenience method to assert that two BN.js instances are NOT equal.
 *  @param actualBN The BN.js instance you received
 *  @param expectedBN The BN.js amount you expected NOT to receive
 *  @param context The description to log if we fail the assertion
 */
const assertBNNotEqual = (
  actualBN: BigNumber,
  expectedBN: BigNumber,
  context?: string
) => {
  _assert.notStrictEqual(actualBN.toString(), expectedBN.toString(), context);
};

export const assert = { ..._assert, bnEqual: assertBNEqual,
  bnNotEqual: assertBNNotEqual, };
