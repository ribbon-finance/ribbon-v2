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

  describe("#assetToShares", () => {
    it("calculates the correct number", async () => {
      const decimals = 8;
      const underlyingAmount = parseUnits("1", 8);
      const pps = parseUnits("2", 8);

      assert.bnEqual(
        await shareMath.assetToShares(underlyingAmount, pps, decimals),
        parseUnits("0.5", 8)
      );
    });
  });

  describe("#sharesToAsset", () => {
    it("calculates the correct number", async () => {
      const decimals = 8;
      const shares = parseUnits("1", 8);
      const pps = parseUnits("2", 8);

      assert.bnEqual(
        await shareMath.sharesToAsset(shares, pps, decimals),
        parseUnits("2", 8)
      );
    });
  });
});
