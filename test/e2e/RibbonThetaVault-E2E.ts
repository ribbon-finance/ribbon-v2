import { BigNumber } from "@ethersproject/bignumber";
import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { Contract } from "ethers";
import hre from "hardhat";
import { assert } from "../helpers/assertions";

const { deployments, ethers } = hre;

let user: string;
let userSigner: SignerWithAddress;

describe("E2E-RibbonThetaVault", () => {
  behavesLikeRibbonThetaVault({
    deploymentName: "RibbonThetaVaultETHCall",
    depositAmount: parseEther("0.0001"),
  });

  before(async () => {
    const { deployer } = await hre.getNamedAccounts();
    user = deployer;
    userSigner = await ethers.getSigner(user);
  });

  function behavesLikeRibbonThetaVault({
    deploymentName,
    depositAmount,
  }: {
    deploymentName: string;
    depositAmount: BigNumber;
  }) {
    describe(deploymentName, () => {
      let vault: Contract;
      let vaultAddress: string;

      before(async () => {
        const { address } = await deployments.get(deploymentName);
        vaultAddress = address;
        vault = await ethers.getContractAt(
          "RibbonThetaVault",
          address,
          userSigner
        );
      });

      const depositIntoVault = async (vault: Contract) => {
        const { asset } = await vault.vaultParams();
        const assetContract = await ethers.getContractAt(
          "IERC20",
          asset,
          userSigner
        );

        const beforeVaultBalance = await assetContract.balanceOf(vault.address);
        const beforeShares = await vault.balanceOf(user);

        const approveTx = await assetContract.approve(
          vault.address,
          depositAmount
        );
        await approveTx.wait();

        const depositTx = await vault.deposit(depositAmount);
        await depositTx.wait();

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          beforeVaultBalance.add(depositAmount)
        );
        // No change in shares
        assert.bnEqual(await vault.balanceOf(user), beforeShares);
      };

      describe("deposit", () => {
        it("deposits successfully", async () => {
          const { amount: beforeAmount } = await vault.depositReceipts(user);

          await depositIntoVault(vault);

          const { round, amount, unredeemedShares } =
            await vault.depositReceipts(user);
          assert.equal(round, 1);
          assert.bnEqual(amount, beforeAmount.add(depositAmount));
          assert.equal(unredeemedShares, 0);
        });
      });

      describe("withdrawInstantly", () => {
        it("withdraws instantly", async () => {
          await depositIntoVault(vault);

          const { amount: beforeAmount } = await vault.depositReceipts(user);

          const withdrawTx = await vault.withdrawInstantly(depositAmount);
          await withdrawTx.wait();

          const { round, amount, unredeemedShares } =
            await vault.depositReceipts(user);
          assert.equal(round, 1);
          assert.bnEqual(amount, beforeAmount.sub(depositAmount));
          assert.equal(unredeemedShares, 0);
        });
      });
    });

    describe("withdrawInstantly", () => {});
  }
});
