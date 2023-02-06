import { ethers, network } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { NULL_ADDR, PLACEHOLDER_ADDR } from "../../constants/constants";

describe("VaultDeploymentHelper", () => {
  let vaultDeploymentHelper: Contract;
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

    const VaultDeploymentHelper = await ethers.getContractFactory(
      "VaultDeploymentHelper"
    );
    vaultDeploymentHelper = await VaultDeploymentHelper.connect(owner).deploy();
  });

  it("reverts when the caller is not the owner", async () => {
    await expect(
      vaultDeploymentHelper.connect(account).newVault(PLACEHOLDER_ADDR)
    ).to.be.revertedWith("caller is not the owner");
  });
  it("reverts when address zero is passed", async () => {
    await expect(
      vaultDeploymentHelper.connect(owner).newVault(NULL_ADDR)
    ).to.be.revertedWith("!_newVaultAddress");
  });
  it("successfully emits the event with the new vault address", async () => {
    const tx = await vaultDeploymentHelper
      .connect(owner)
      .newVault(PLACEHOLDER_ADDR);

    await expect(tx)
      .to.emit(vaultDeploymentHelper, "NewVault")
      .withArgs(PLACEHOLDER_ADDR);
  });
});
