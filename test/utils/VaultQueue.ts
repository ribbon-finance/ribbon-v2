import { ethers, network } from "hardhat";
import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { BigNumber, Contract } from "ethers";
import { assert } from "../helpers/assertions";
import { expect } from "chai";
import {
  CHAINID,
  CHAINLINK_WETH_PRICER,
  SAVAX_PRICER,
  ORACLE_OWNER,
  GAMMA_ORACLE,
  WETH_ADDRESS,
  SAVAX_ADDRESS,
  STETH_ADDRESS,
} from "../../constants/constants";
import {
  resetBlock,
  impersonate,
  sendEth,
  forceSend,
  rollToNextOption,
  setOpynOracleExpiryPrice,
  getCurrentOptionExpiry,
} from "../helpers/utils";

import ETH_RibbonThetaVaultLogic from "../../deployments/mainnet/RibbonThetaVaultLogic.json";
import ETH_RibbonThetaVaultETHCall from "../../deployments/mainnet/RibbonThetaVaultETHCall.json";
import ETH_RibbonThetaVaultSTETHCall from "../../deployments/mainnet/RibbonThetaVaultSTETHCall.json";
import ETH_StrikeSelectionETH from "../../deployments/mainnet/StrikeSelectionETH.json";

import AVAX_RibbonThetaVaultLogic from "../../deployments/avax/RibbonThetaVaultLogic.json";
import AVAX_RibbonThetaVaultETHCall from "../../deployments/avax/RibbonThetaVaultETHCall.json";
import AVAX_RibbonThetaVaultSAVAXCall from "../../deployments/avax/RibbonThetaVaultSAVAXCall.json";
import AVAX_StrikeSelectionETH from "../../deployments/avax/StrikeSelectionETH.json";

const { parseEther } = ethers.utils;

describe("VaultQueue - ETH -> stETH", () => {
  if (network.config.chainId !== CHAINID.ETH_MAINNET) return;

  let signer1: JsonRpcSigner, signer2: JsonRpcSigner;
  let keeperSigner: SignerWithAddress,
    ownerSigner: JsonRpcSigner,
    pricerSigner: JsonRpcSigner;
  let vaultQueue: Contract, srcVault: Contract, dstVault: Contract;
  let oracleContract: Contract, strikeSelection: Contract;
  let stEth: Contract;

  beforeEach(async () => {
    // Find the block the when the pricer pushed the eth price and subtract one
    await resetBlock(process.env.MAINNET_URI, 14319247);

    // Nothing special about this user other than he's a depositor that has not redeemed any shares.
    // Randomly selected a depositor from the vault transaction history to mock.
    const MOCK_USER_1 = "0x39814E72Fbc713dad3314969758A223192B8aDc1";
    const MOCK_USER_2 = "0xa13d074fe7f27a1a126892e636a22a12d19e6858";

    signer1 = await impersonate(MOCK_USER_1);
    signer2 = await impersonate(MOCK_USER_2);

    [keeperSigner] = await ethers.getSigners();

    await sendEth(await signer1.getAddress(), "1");

    await sendEth(await signer2.getAddress(), "1");

    const VaultQueue = await ethers.getContractFactory("VaultQueue");
    vaultQueue = await VaultQueue.deploy();
    await vaultQueue.initialize();

    srcVault = await ethers.getContractAt(
      ETH_RibbonThetaVaultLogic.abi,
      ETH_RibbonThetaVaultETHCall.address
    );

    dstVault = await ethers.getContractAt(
      ETH_RibbonThetaVaultLogic.abi,
      ETH_RibbonThetaVaultSTETHCall.address
    );

    ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.ETH_MAINNET]);
    pricerSigner = await impersonate(
      CHAINLINK_WETH_PRICER[CHAINID.ETH_MAINNET]
    );

    oracleContract = await ethers.getContractAt(
      "IOracle",
      GAMMA_ORACLE[CHAINID.ETH_MAINNET]
    );
    strikeSelection = await ethers.getContractAt(
      ETH_StrikeSelectionETH.abi,
      ETH_StrikeSelectionETH.address,
      ownerSigner
    );
    stEth = await ethers.getContractAt("ERC20", STETH_ADDRESS);

    // Load up addresses with ETH for gas
    await forceSend(await pricerSigner.getAddress(), "10");
    await sendEth(await ownerSigner.getAddress(), "10");

    vaultQueue.pushVault(srcVault.address);
    // vaultQueue.pushVault(dstVault.address);
  });

  it("Queues up a vault transfer from src vault to dst vault", async () => {
    assert.equal(
      (await srcVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await srcVault.connect(signer1).maxRedeem();

    const balance = (
      await srcVault.shares(await signer1.getAddress())
    ).toString();
    assert.equal(balance, "9360711591524105194");

    await srcVault.connect(signer1).approve(vaultQueue.address, balance);

    const queueTransferTx = await vaultQueue
      .connect(signer1)
      .queueTransfer(
        srcVault.address,
        dstVault.address,
        dstVault.address,
        balance
      );

    assert.equal(
      (await srcVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await expect(queueTransferTx)
      .to.emit(srcVault, "InitiateWithdraw")
      .withArgs(vaultQueue.address, balance, "26");

    await setOpynOracleExpiryPrice(
      WETH_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract.connect(pricerSigner),
      await getCurrentOptionExpiry(srcVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(srcVault, strikeSelection);

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    const interVaultTransferTx = await vaultQueue
      .connect(keeperSigner)
      .transfer();

    await expect(interVaultTransferTx)
      .to.emit(srcVault, "Withdraw")
      .withArgs(vaultQueue.address, "10072592725506459998", balance);

    await expect(interVaultTransferTx)
      .to.emit(dstVault, "Deposit")
      .withArgs(await signer1.getAddress(), "10072592725506459998", "16");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );
  });

  it("Queues up multiple vault transfer from src vault to dst vault", async () => {
    await srcVault.connect(signer1).maxRedeem();
    await srcVault.connect(signer2).maxRedeem();

    const balance1 = (
      await srcVault.shares(await signer1.getAddress())
    ).toString();
    await srcVault.connect(signer1).approve(vaultQueue.address, balance1);
    await vaultQueue
      .connect(signer1)
      .queueTransfer(
        srcVault.address,
        dstVault.address,
        dstVault.address,
        balance1
      );

    const balance2 = (
      await srcVault.shares(await signer2.getAddress())
    ).toString();
    await srcVault.connect(signer2).approve(vaultQueue.address, balance2);
    await vaultQueue
      .connect(signer2)
      .queueTransfer(
        srcVault.address,
        dstVault.address,
        dstVault.address,
        balance2
      );

    await setOpynOracleExpiryPrice(
      WETH_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract.connect(pricerSigner),
      await getCurrentOptionExpiry(srcVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(srcVault, strikeSelection);

    const interVaultTransferTx = await vaultQueue
      .connect(keeperSigner)
      .transfer();

    await expect(interVaultTransferTx)
      .to.emit(srcVault, "Withdraw")
      .withArgs(
        vaultQueue.address,
        "10173004590515289225",
        "9454026841562415564"
      );

    await expect(interVaultTransferTx)
      .to.emit(dstVault, "Deposit")
      .withArgs(await signer1.getAddress(), "10072592725506459993", "16");

    await expect(interVaultTransferTx)
      .to.emit(dstVault, "Deposit")
      .withArgs(await signer2.getAddress(), "100411865008829232", "16");
  });

  it("Doesn't allow the same user to queue up multiple withdrawals", async () => {
    await srcVault.connect(signer1).maxRedeem();
    const balance = (
      await srcVault.shares(await signer1.getAddress())
    ).toString();
    await srcVault.connect(signer1).approve(vaultQueue.address, balance);

    assert.isFalse(await vaultQueue.hasWithdrawal(await signer1.getAddress()));

    await vaultQueue
      .connect(signer1)
      .queueTransfer(
        srcVault.address,
        dstVault.address,
        dstVault.address,
        "1000"
      );

    assert.isTrue(await vaultQueue.hasWithdrawal(await signer1.getAddress()));

    await expect(
      vaultQueue
        .connect(signer1)
        .queueTransfer(
          srcVault.address,
          dstVault.address,
          dstVault.address,
          "1000"
        )
    ).to.be.revertedWith("Withdraw already submitted");
  });

  it("rescueETH() works for only owner", async () => {
    await signer1.sendTransaction({
      to: vaultQueue.address,
      value: parseEther("1"),
    });
    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      parseEther("1").toString()
    );
    const keeperBalance = (
      await ethers.provider.getBalance(keeperSigner.address)
    ).toString();
    assert.equal(keeperBalance, "9989968415047367807578");
    const txn = await vaultQueue
      .connect(keeperSigner)
      .rescueETH(parseEther("1"));
    const receipt = await txn.wait();
    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );
    const effectiveBalance = BigNumber.from(keeperBalance)
      .sub(receipt.effectiveGasPrice.mul(receipt.gasUsed))
      .sub(parseEther("1"));
    assert.equal(effectiveBalance.toString(), "9988968155621634273306");
  });

  it("rescueETH() fails for wrong owner", async () => {
    await signer1.sendTransaction({
      to: vaultQueue.address,
      value: BigNumber.from("1000"),
    });
    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "1000"
    );
    await expect(
      vaultQueue.connect(signer1).rescueETH("1000")
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });

  it("rescue() works for only owner", async () => {
    await stEth.connect(signer1).transfer(vaultQueue.address, "10000");
    assert.equal(
      (await stEth.balanceOf(await vaultQueue.address)).toString(),
      "9999"
    );

    await vaultQueue.connect(keeperSigner).rescue(stEth.address, "1000");

    assert.equal(
      (await stEth.balanceOf(await vaultQueue.address)).toString(),
      "8999"
    );
  });

  it("rescue() fails for wrong owner", async () => {
    await stEth.connect(signer1).transfer(vaultQueue.address, "10");
    assert.equal(
      (await stEth.balanceOf(await vaultQueue.address)).toString(),
      "9"
    );
    await expect(
      vaultQueue.connect(signer1).rescue(await stEth.address, "9")
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });
});

describe("VaultQueue - AVAX -> sAVAX", () => {
  if (network.config.chainId !== CHAINID.AVAX_MAINNET) return;

  let signer1: JsonRpcSigner;
  let keeperSigner: SignerWithAddress,
    ownerSigner: JsonRpcSigner,
    pricerSigner: JsonRpcSigner;
  let vaultQueue: Contract,
    srcVault: Contract,
    dstVault: Contract,
    stakingHelper: Contract;
  let oracleContract: Contract, strikeSelection: Contract;

  beforeEach(async () => {
    await resetBlock(process.env.AVAX_URI, 12256615);

    const MOCK_USER_1 = "0xc415f079430687a2692c719b63eb1fb795785fb1";

    signer1 = await impersonate(MOCK_USER_1);

    [keeperSigner] = await ethers.getSigners();

    await sendEth(await signer1.getAddress(), "10");

    const StakingHelper = await ethers.getContractFactory("SAVAXDepositHelper");
    stakingHelper = await StakingHelper.deploy(
      SAVAX_ADDRESS[CHAINID.AVAX_MAINNET],
      AVAX_RibbonThetaVaultSAVAXCall.address
    );

    const VaultQueue = await ethers.getContractFactory("VaultQueue");
    vaultQueue = await VaultQueue.deploy();
    await vaultQueue.initialize();

    srcVault = await ethers.getContractAt(
      AVAX_RibbonThetaVaultLogic.abi,
      AVAX_RibbonThetaVaultETHCall.address
    );

    dstVault = await ethers.getContractAt(
      AVAX_RibbonThetaVaultLogic.abi,
      AVAX_RibbonThetaVaultSAVAXCall.address
    );

    ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.AVAX_MAINNET]);
    pricerSigner = await impersonate(SAVAX_PRICER);

    oracleContract = await ethers.getContractAt(
      "IOracle",
      GAMMA_ORACLE[CHAINID.AVAX_MAINNET]
    );
    strikeSelection = await ethers.getContractAt(
      AVAX_StrikeSelectionETH.abi,
      AVAX_StrikeSelectionETH.address,
      ownerSigner
    );

    await forceSend(await pricerSigner.getAddress(), "10");
    await sendEth(await ownerSigner.getAddress(), "10");

    vaultQueue.pushVault(srcVault.address);
    // vaultQueue.pushVault(dstVault.address);
  });

  it("Queues up a vault transfer from src vault to dst vault", async () => {
    assert.equal(
      (await srcVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await srcVault.connect(signer1).maxRedeem();

    const balance = (
      await srcVault.shares(await signer1.getAddress())
    ).toString();
    assert.equal(balance, "60077571663919879198");

    await srcVault.connect(signer1).approve(vaultQueue.address, balance);

    const queueTransferTx = await vaultQueue
      .connect(signer1)
      .queueTransfer(
        srcVault.address,
        dstVault.address,
        stakingHelper.address,
        balance
      );

    assert.equal(
      (await srcVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await expect(queueTransferTx)
      .to.emit(srcVault, "InitiateWithdraw")
      .withArgs(vaultQueue.address, balance, "16");

    await setOpynOracleExpiryPrice(
      SAVAX_ADDRESS[CHAINID.AVAX_MAINNET],
      oracleContract.connect(pricerSigner),
      await getCurrentOptionExpiry(srcVault),
      BigNumber.from("7125324071")
    );

    await rollToNextOption(srcVault, strikeSelection);

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    const interVaultTransferTx = await vaultQueue
      .connect(keeperSigner)
      .transfer();

    await expect(interVaultTransferTx)
      .to.emit(srcVault, "Withdraw")
      .withArgs(vaultQueue.address, "59975246775152228377", balance);

    await expect(interVaultTransferTx)
      .to.emit(dstVault, "Deposit")
      .withArgs(await signer1.getAddress(), "59615196604141846696", "4");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );
  });
});
