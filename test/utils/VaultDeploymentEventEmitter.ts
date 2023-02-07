import { ethers, network } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { NULL_ADDR, PLACEHOLDER_ADDR } from "../../constants/constants";
import { assert } from "../helpers/assertions";

describe("VaultDeploymentEventEmitter", () => {
  let vaultDeploymentEventEmitter: Contract;
  let owner: SignerWithAddress;
  let account: SignerWithAddress;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: 15038742,
          },
        },
      ],
    });

    [owner, account] = await ethers.getSigners();

    const VaultDeploymentEventEmitter = await ethers.getContractFactory(
      "VaultDeploymentEventEmitter"
    );
    vaultDeploymentEventEmitter = await VaultDeploymentEventEmitter.connect(
      owner
    ).deploy();
  });

  describe("#newVault", () => {
    it("reverts when the caller is not the owner", async () => {
      await expect(
        vaultDeploymentEventEmitter
          .connect(account)
          .newVault(PLACEHOLDER_ADDR, 0)
      ).to.be.revertedWith("caller is not the owner");
    });
    it("reverts when address zero is passed", async () => {
      await expect(
        vaultDeploymentEventEmitter.connect(owner).newVault(NULL_ADDR, 0)
      ).to.be.revertedWith("!_newVaultAddress");
    });
    it("reverts when invalid vault type is passed", async () => {
      await expect(
        vaultDeploymentEventEmitter.connect(owner).newVault(NULL_ADDR, 6)
      ).to.be.reverted;
    });
    it("successfully emits the event with the new vault address", async () => {
      const tx = await vaultDeploymentEventEmitter
        .connect(owner)
        .newVault(PLACEHOLDER_ADDR, 0);

      await expect(tx)
        .to.emit(vaultDeploymentEventEmitter, "NewVault")
        .withArgs(PLACEHOLDER_ADDR, 0);

      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(0), [
        PLACEHOLDER_ADDR,
      ]);
    });
  });

  describe("#getVaultAddresses", () => {
    it("reverts when invalid vault type is passed", async () => {
      await expect(vaultDeploymentEventEmitter.getVaultAddresses(6)).to.be
        .reverted;
    });
    it("successfully returns the correct value", async () => {
      await vaultDeploymentEventEmitter
        .connect(owner)
        .newVault(PLACEHOLDER_ADDR, 0);

      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(0), [
        PLACEHOLDER_ADDR,
        PLACEHOLDER_ADDR,
      ]);
    });
  });
});
