import { ethers } from "hardhat";
import { Contract } from "ethers";
import moment from "moment-timezone";
import { assert } from "../helpers/assertions";
import * as time from "../helpers/time";
import { parseEther } from "ethers/lib/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { expect } from "chai";
import { STETH_ADDRESS, WSTETH_ADDRESS } from "../../constants/constants";

moment.tz.setDefault("UTC");

// const provider = ethers.provider;
// const gasPrice = parseUnits("1", "gwei");

describe("VaultLifecycleSTETH", () => {
  let lifecycle: Contract;
  let signer: SignerWithAddress;
  let stETH: Contract;
  let wstETH: Contract;
  // let crv: Contract;

  beforeEach(async () => {
    [signer] = await ethers.getSigners();

    const VaultLifecycle = await ethers.getContractFactory(
      "VaultLifecycleSTETH"
    );
    const lifecycleLib = await VaultLifecycle.deploy();

    const TestVaultLifecycle = await ethers.getContractFactory(
      "TestVaultLifecycleSTETH",
      { libraries: { VaultLifecycleSTETH: lifecycleLib.address } }
    );
    lifecycle = await TestVaultLifecycle.deploy();
    lifecycle = lifecycle.connect(signer);

    stETH = await ethers.getContractAt("ISTETH", STETH_ADDRESS, signer);
    wstETH = await ethers.getContractAt("IWSTETH", WSTETH_ADDRESS, signer);
    // crv = await ethers.getContractAt("ICRV", STETH_ETH_CRV_POOL, signer);
  });

  describe("unwrapYieldToken", () => {
    time.revertToSnapshotAfterEach();

    it("returns the full amount if balance is >= amount", async () => {
      await signer.sendTransaction({
        to: lifecycle.address,
        value: parseEther("1"),
      });

      await lifecycle.unwrapYieldToken(parseEther("1"), parseEther("1"));

      expect(await lifecycle.output()).to.equals(parseEther("1"));
    });

    it("reverts if amount < minETHOut", async () => {
      await signer.sendTransaction({
        to: lifecycle.address,
        value: parseEther("1"),
      });

      await expect(
        lifecycle.unwrapYieldToken(parseEther("0.9"), parseEther("1"))
      ).to.be.revertedWith("Amount withdrawn smaller than minETHOut from swap");
    });

    it("performs a swap when balance is less than withdraw amount", async () => {
      // only 0.5 on contract so we need to swap 0.5
      await signer.sendTransaction({
        to: lifecycle.address,
        value: parseEther("0.5"),
      });

      await stETH.submit(signer.address, { value: parseEther("0.5") });

      await stETH.approve(wstETH.address, parseEther("0.5"));

      await wstETH.wrap(parseEther("0.5"));

      await wstETH.transfer(
        lifecycle.address,
        await wstETH.balanceOf(signer.address)
      );

      await lifecycle.unwrapYieldToken(
        parseEther("1"),
        parseEther("0.995") // 0.5% slippage
      );

      assert.bnGte(await lifecycle.output(), parseEther("0.995"));
    });
  });
});
