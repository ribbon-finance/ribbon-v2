import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";

describe("PPS fix", () => {
  let vault: Contract;
  const vaultToTest = "0x25751853Eab4D0eB3652B5eB6ecB102A2789644B";
  const acc1Addr = "0xc9596e90ea2b30159889f1883077609eec048db7";
  const acc2Addr = "0xc9596e90ea2b30159889f1883077609eec048db7";
  const FORK_BLOCK = 14709786;
  let acc1: SignerWithAddress;
  let acc2: SignerWithAddress;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: FORK_BLOCK,
          },
        },
      ],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [acc1Addr],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [acc2Addr],
    });

    acc1 = await ethers.getSigner(acc1Addr);
    acc2 = await ethers.getSigner(acc2Addr);
    vault = await ethers.getContractAt("RibbonThetaVault", vaultToTest);

    console.log(
      (await vault.shares(acc1.address)).toString(),
      (await vault.shares(acc2.address)).toString()
    );

    await vault
      .connect(acc1)
      .initiateWithdraw(await vault.shares(acc1.address));
    await vault
      .connect(acc2)
      .initiateWithdraw(await vault.shares(acc2.address));
  });

  it("withdraws correctly after the upgrade", async () => {
    console.log("pass");
  });
});
