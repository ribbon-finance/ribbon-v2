import { BigNumber } from "@ethersproject/bignumber";
import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
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
      describe("deposit", () => {
        it("deposits successfully", async () => {
          const { address } = await deployments.get(deploymentName);
          const vault = await ethers.getContractAt(
            "RibbonThetaVault",
            address,
            userSigner
          );
          const { asset } = await vault.vaultParams();
          const assetContract = await ethers.getContractAt(
            "IERC20",
            asset,
            userSigner
          );

          const { amount: beforeAmount } = await vault.depositReceipts(user);

          const approveTx = await assetContract.approve(
            vault.address,
            depositAmount
          );
          await approveTx.wait(1);

          const depositTx = await vault.deposit(depositAmount);
          await depositTx.wait(1);

          const { round, amount, unredeemedShares } =
            await vault.depositReceipts(user);
          assert.equal(round, 1);
          assert.bnEqual(amount, beforeAmount.add(depositAmount));
          assert.equal(unredeemedShares, 0);
        });
      });
    });
  }
});
