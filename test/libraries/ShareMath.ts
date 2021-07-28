import { ethers } from "hardhat";
import { Contract } from "ethers";
import { assert } from "../helpers/assertions";
import { parseUnits } from "ethers/lib/utils";

let shareMath: Contract;

describe("ShareMath", () => {
  before(async () => {
    const TestShareMath = await ethers.getContractFactory("TestShareMath");
    shareMath = await TestShareMath.deploy();
  });

  describe("#underlyingToShares", () => {
    it("calculates the correct number", async () => {
      const decimals = 8;
      const underlyingAmount = parseUnits("1", 8);
      const pps = parseUnits("2", 8);

      assert.bnEqual(
        await shareMath.underlyingToShares(underlyingAmount, pps, decimals),
        parseUnits("0.5", 8)
      );
    });
  });

  describe("#sharesToUnderlying", () => {
    it("calculates the correct number", async () => {
      const decimals = 8;
      const shares = parseUnits("1", 8);
      const pps = parseUnits("2", 8);

      assert.bnEqual(
        await shareMath.sharesToUnderlying(shares, pps, decimals),
        parseUnits("2", 8)
      );
    });
  });
});
