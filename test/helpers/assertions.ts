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

/**
 *  Convenience method to assert that the value of left operand is greater than then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
const assertBNGreaterThan = (aBN, bBN) => {
  assert.ok(
    aBN.gt(bBN),
    `${aBN.toString()} is not greater than ${bBN.toString()}`
  );
};

/**
 *  Convenience method to assert that the value of left operand is greater than or equal then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
const assertBNGreaterEqualThan = (aBN, bBN) => {
  assert.ok(
    aBN.gte(bBN),
    `${aBN.toString()} is not greater than or equal to ${bBN.toString()}`
  );
};

/**
 *  Convenience method to assert that the value of left operand is less than then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
const assertBNLessThan = (aBN, bBN) => {
  assert.ok(
    aBN.lt(bBN),
    `${aBN.toString()} is not less than ${bBN.toString()}`
  );
};

/**
 *  Convenience method to assert that the value of left operand is less than then value of the right operand
 *  @param aBN The left operand BN.js instance
 *  @param bBN The right operand BN.js instance
 */
const assertBNLessEqualThan = (aBN, bBN) => {
  assert.ok(
    aBN.lte(bBN),
    `${aBN.toString()} is not less than or equal to ${bBN.toString()}`
  );
};

export const assert = {
  ..._assert,
  bnEqual: assertBNEqual,
  bnNotEqual: assertBNNotEqual,
  bnLte: assertBNLessEqualThan,
  bnLt: assertBNLessThan,
  bnGt: assertBNGreaterThan,
  bnGte: assertBNGreaterEqualThan,
};
