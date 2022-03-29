import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, Contract } from "ethers";
import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "../helpers/assertions";
import { increaseTo } from "../helpers/time";
import {
  NULL_ADDR,
  STETH_ETH_CRV_POOL,
  CHAINID,
  CHAINLINK_WETH_PRICER,
  CHAINLINK_WBTC_PRICER,
  SAVAX_PRICER,
  ORACLE_OWNER,
  GAMMA_ORACLE,
  WETH_ADDRESS,
  WBTC_ADDRESS,
  SAVAX_ADDRESS,
  STETH_ADDRESS,
  WSTETH_ADDRESS,
  WSTETH_PRICER,
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
import ETH_RibbonThetaVaultSTETHLogic from "../../deployments/mainnet/RibbonThetaVaultSTETHLogic.json";

import ETH_RibbonThetaVaultETHCall from "../../deployments/mainnet/RibbonThetaVaultETHCall.json";
import ETH_RibbonThetaVaultSTETHCall from "../../deployments/mainnet/RibbonThetaVaultSTETHCall.json";
import ETH_RibbonThetaVaultWBTCCall from "../../deployments/mainnet/RibbonThetaVaultWBTCCall.json";

import ETH_StrikeSelectionETH from "../../deployments/mainnet/StrikeSelectionETH.json";
import ETH_StrikeSelectionWBTC from "../../deployments/mainnet/StrikeSelectionWBTC.json";

import AVAX_RibbonThetaVaultLogic from "../../deployments/avax/RibbonThetaVaultLogic.json";
import AVAX_RibbonThetaVaultETHCall from "../../deployments/avax/RibbonThetaVaultETHCall.json";
import AVAX_RibbonThetaVaultSAVAXCall from "../../deployments/avax/RibbonThetaVaultSAVAXCall.json";
import AVAX_StrikeSelectionETH from "../../deployments/avax/StrikeSelectionETH.json";

const { parseEther } = ethers.utils;

describe("VaultQueue", () => {
  if (network.config.chainId !== CHAINID.ETH_MAINNET) return;

  let signer1: JsonRpcSigner,
      signer2: JsonRpcSigner,
      signer3: JsonRpcSigner,
      signer4: JsonRpcSigner,
      signer5: JsonRpcSigner;
  let keeperSigner: SignerWithAddress,
    ownerSigner: JsonRpcSigner,
    wethPriceSigner: JsonRpcSigner,
    wbtcPriceSigner: JsonRpcSigner,
    wstethPriceSigner: JsonRpcSigner;
  let vaultQueue: Contract;
  let ethCallVault: Contract, stethCallVault: Contract, wbtcCallVault: Contract;
  let oracleContract: Contract, strikeSelectionETH: Contract, strikeSelectionWBTC: Contract;
  let steth: Contract, wbtc: Contract;

  beforeEach(async () => {
    await resetBlock(process.env.MAINNET_URI, 14319200);

    // Nothing special about this user other than he's a depositor that has not redeemed any shares.
    // Randomly selected a depositor from the vault transaction history to mock.
    const MOCK_USER_1 = "0x39814E72Fbc713dad3314969758A223192B8aDc1"; // eth deposited in eth call vault
    const MOCK_USER_2 = "0xa13d074fe7f27a1a126892e636a22a12d19e6858"; // eth call vault
    const MOCK_USER_3 = "0x35bb7ab3956738e0b6e9e1cbc1732d357bee9793"; // stETH call vault
    const MOCK_USER_4 = "0x82738b0ebc1d667765cb9cdeb4a2a96da6e6a77a"; // wbtc call vault
    const MOCK_USER_5 = "0xe2e96c461df0cdb5300640feaebf9f145adcd709"; // eth call vault

    signer1 = await impersonate(MOCK_USER_1);
    signer2 = await impersonate(MOCK_USER_2);
    signer3 = await impersonate(MOCK_USER_3);
    signer4 = await impersonate(MOCK_USER_4);
    signer5 = await impersonate(MOCK_USER_5);

    [keeperSigner] = await ethers.getSigners();

    await sendEth(await signer1.getAddress(), "1");
    await sendEth(await signer2.getAddress(), "1");
    await sendEth(await signer3.getAddress(), "1");
    await sendEth(await signer4.getAddress(), "1");
    await sendEth(await signer5.getAddress(), "1");

    ethCallVault = await ethers.getContractAt(
      ETH_RibbonThetaVaultLogic.abi,
      ETH_RibbonThetaVaultETHCall.address
    );
    stethCallVault = await ethers.getContractAt(
      ETH_RibbonThetaVaultSTETHLogic.abi,
      ETH_RibbonThetaVaultSTETHCall.address
    );
    wbtcCallVault = await ethers.getContractAt(
      ETH_RibbonThetaVaultLogic.abi,
      ETH_RibbonThetaVaultWBTCCall.address
    );

    const VaultQueue = await ethers.getContractFactory("VaultQueue");
    vaultQueue = await VaultQueue.deploy();
    await vaultQueue.initialize(ethCallVault.address, stethCallVault.address, STETH_ETH_CRV_POOL);

    ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.ETH_MAINNET]);
    wethPriceSigner = await impersonate(CHAINLINK_WETH_PRICER[CHAINID.ETH_MAINNET]);
    wstethPriceSigner = await impersonate(WSTETH_PRICER);
    wbtcPriceSigner = await impersonate(CHAINLINK_WBTC_PRICER[CHAINID.ETH_MAINNET]);

    oracleContract = await ethers.getContractAt(
      "IOracle",
      GAMMA_ORACLE[CHAINID.ETH_MAINNET]
    );

    strikeSelectionETH = await ethers.getContractAt(
      ETH_StrikeSelectionETH.abi,
      ETH_StrikeSelectionETH.address,
      ownerSigner
    );

    strikeSelectionWBTC = await ethers.getContractAt(
      ETH_StrikeSelectionWBTC.abi,
      ETH_StrikeSelectionWBTC.address,
      ownerSigner
    );

    steth = await ethers.getContractAt("ERC20", STETH_ADDRESS);
    wbtc = await ethers.getContractAt("ERC20", WBTC_ADDRESS[CHAINID.ETH_MAINNET]);

    // Load up addresses with ETH for gas
    await forceSend(await wethPriceSigner.getAddress(), "10");
    await forceSend(await wstethPriceSigner.getAddress(), "10");
    await forceSend(await wbtcPriceSigner.getAddress(), "10");
    await sendEth(await ownerSigner.getAddress(), "10");
  });

  it("Queues up a vault transfer from ETH vault to stETH vault", async () => {
    assert.equal(
      (await ethCallVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await ethCallVault.connect(signer1).maxRedeem();

    const balance = (
      await ethCallVault.shares(await signer1.getAddress())
    ).toString();
    assert.equal(balance, "9360711591524105194");

    await setOpynOracleExpiryPrice(
      WETH_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract,
      await wethPriceSigner.getAddress(),
      await getCurrentOptionExpiry(ethCallVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(ethCallVault, strikeSelectionETH);

    await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

    const queueTransferTx = await vaultQueue
      .connect(signer1)
      .queueTransfer(
        ethCallVault.address,
        stethCallVault.address,
        stethCallVault.address,
        "0",
        balance
      );

    assert.equal(
      (await ethCallVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await expect(queueTransferTx)
      .to.emit(ethCallVault, "InitiateWithdraw")
      .withArgs(vaultQueue.address, balance, "27");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    await setOpynOracleExpiryPrice(
      WETH_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract,
      await wethPriceSigner.getAddress(),
      await getCurrentOptionExpiry(ethCallVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(ethCallVault, strikeSelectionETH);

    const interVaultTransferTx = await vaultQueue
      .connect(keeperSigner)
      .transfer(ethCallVault.address);

    await expect(interVaultTransferTx)
      .to.emit(ethCallVault, "Withdraw")
      .withArgs(vaultQueue.address, "10072592725506459998", balance);

    await expect(interVaultTransferTx)
      .to.emit(stethCallVault, "Deposit")
      .withArgs(await signer1.getAddress(), "10072592725506459998", "16");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );
  });

  it("Queues up multiple vault transfer from ETH vault to stETH vault", async () => {
    await ethCallVault.connect(signer1).maxRedeem();
    await ethCallVault.connect(signer2).maxRedeem();
    await ethCallVault.connect(signer5).maxRedeem();

    const balance1 = (
      await ethCallVault.shares(await signer1.getAddress())
    ).toString();

    const balance2 = (
      await ethCallVault.shares(await signer2.getAddress())
    ).toString();

    const balance3 = (
      await ethCallVault.shares(await signer5.getAddress())
    ).toString();

    // Verify users have balances
    assert.isAbove(Number(balance1), 1);
    assert.isAbove(Number(balance2), 1);
    assert.isAbove(Number(balance3), 1);

    await ethCallVault.connect(signer1).approve(vaultQueue.address, balance1);
    await vaultQueue
      .connect(signer1)
      .queueTransfer(
        ethCallVault.address,
        stethCallVault.address,
        stethCallVault.address,
        "0",
        balance1
      );

    await ethCallVault.connect(signer2).approve(vaultQueue.address, balance2);
    await vaultQueue
      .connect(signer2)
      .queueTransfer(
        ethCallVault.address,
        stethCallVault.address,
        stethCallVault.address,
        "0",
        balance2
      );

    await ethCallVault.connect(signer5).approve(vaultQueue.address, balance3);
    await vaultQueue
      .connect(signer5)
      .queueTransfer(
        ethCallVault.address,
        stethCallVault.address,
        stethCallVault.address,
        "0",
        balance3
      );

    await setOpynOracleExpiryPrice(
      WETH_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract,
      await wethPriceSigner.getAddress(),
      await getCurrentOptionExpiry(ethCallVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(ethCallVault, strikeSelectionETH);

    const interVaultTransferTx = await vaultQueue
      .connect(keeperSigner)
      .transfer(ethCallVault.address);

    // Uncomment, to debug events emitted
    // const receipt = await ethers.provider.getTransactionReceipt(interVaultTransferTx.hash);
    // console.log(receipt.logs);

    await expect(interVaultTransferTx)
      .to.emit(ethCallVault, "Withdraw")
      .withArgs(
        vaultQueue.address,
        "57738042189631111691",
        "53657402371464636689"
      );

    await expect(interVaultTransferTx)
      .to.emit(stethCallVault, "Deposit")
      .withArgs(await signer1.getAddress(), "10072592725506459997", "16");

    await expect(interVaultTransferTx)
      .to.emit(stethCallVault, "Deposit")
      .withArgs(await signer2.getAddress(), "100411865008829239", "16");

    await expect(interVaultTransferTx)
      .to.emit(stethCallVault, "Deposit")
      .withArgs(await signer5.getAddress(), "47565037599115822455", "16");
  });

  it("Doesn't allow the same user to queue up multiple withdrawals", async () => {
    await ethCallVault.connect(signer1).maxRedeem();
    const balance = (
      await ethCallVault.shares(await signer1.getAddress())
    ).toString();
    await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

    assert.isFalse(await vaultQueue.hasWithdrawal(ethCallVault.address, await signer1.getAddress()));

    await vaultQueue
      .connect(signer1)
      .queueTransfer(
        ethCallVault.address,
        stethCallVault.address,
        stethCallVault.address,
        "0",
        "1000"
      );

    assert.isTrue(await vaultQueue.hasWithdrawal(ethCallVault.address, await signer1.getAddress()));

    await expect(
      vaultQueue
        .connect(signer1)
        .queueTransfer(
          ethCallVault.address,
          stethCallVault.address,
          stethCallVault.address,
          "0",
          "1000"
        )
    ).to.be.revertedWith("Withdraw already submitted");
  });

  //
  // Withdrawal
  ///
  it("Queues up a vault withdraw from ETH vault to creditor", async () => {
    await ethCallVault.connect(signer1).maxRedeem();
    const balance = (
      await ethCallVault.shares(await signer1.getAddress())
    ).toString();

    await setOpynOracleExpiryPrice(
      WETH_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract,
      await wethPriceSigner.getAddress(),
      await getCurrentOptionExpiry(ethCallVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(ethCallVault, strikeSelectionETH);

    await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

    await vaultQueue
      .connect(signer1)
      .queueTransfer(
        ethCallVault.address,
        stethCallVault.address,
        await signer1.getAddress(),
        "1",
        balance
      );

    await setOpynOracleExpiryPrice(
      WETH_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract,
      await wethPriceSigner.getAddress(),
      await getCurrentOptionExpiry(ethCallVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(ethCallVault, strikeSelectionETH);

    assert.equal(
      (await ethers.provider.getBalance(await signer1.getAddress())).toString(),
      "6335844911081691444"
    );

    await vaultQueue.connect(keeperSigner).transfer(ethCallVault.address);

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    assert.equal(
      (await ethers.provider.getBalance(await signer1.getAddress())).toString(),
      "16408437636588151442"
    );
  });

  it("Queues up a vault withdraw from STETH vault to creditor", async () => {
    const setExpiryPrices = async () => {
      const disputePeriod = await oracleContract.getPricerDisputePeriod(
        await wstethPriceSigner.getAddress()
      );
      const lockingPeriod = await oracleContract.getPricerLockingPeriod(
        await wstethPriceSigner.getAddress()
      );
      const expiry = await getCurrentOptionExpiry(stethCallVault);
      await increaseTo(expiry.toNumber() + lockingPeriod.toNumber());

      await oracleContract
        .connect(wstethPriceSigner)
        .setExpiryPrice(
          WSTETH_ADDRESS[CHAINID.ETH_MAINNET],
          expiry,
          BigNumber.from("100000000000")
        );

      const res = await oracleContract
        .connect(wethPriceSigner)
        .setExpiryPrice(
          WETH_ADDRESS[CHAINID.ETH_MAINNET],
          expiry,
          BigNumber.from("100000000000")
        );

      const receipt = await res.wait();
      const timestamp = (await ethers.provider.getBlock(receipt.blockNumber))
        .timestamp;
      await increaseTo(timestamp + disputePeriod.toNumber());
    };

    assert.equal(
      (await steth.balanceOf(await signer3.getAddress())).toString(),
      "0"
    );

    await stethCallVault.connect(signer3).maxRedeem();

    const balance = (
      await stethCallVault.balanceOf(await signer3.getAddress())
    ).toString();
    assert.equal(balance, "428942063139228184");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    await setExpiryPrices();
    await rollToNextOption(stethCallVault, strikeSelectionETH);

    await stethCallVault.connect(signer3).approve(vaultQueue.address, balance);

    await vaultQueue
      .connect(signer3)
      .queueTransfer(
        stethCallVault.address,
        stethCallVault.address,
        await signer3.getAddress(),
        "1",
        balance
      );

    assert.equal(
      (await stethCallVault.balanceOf(
        await signer3.getAddress())
      ).toString(),
      "0"
    );

    await setExpiryPrices();
    await rollToNextOption(stethCallVault, strikeSelectionETH);

    await vaultQueue.connect(keeperSigner).transfer(stethCallVault.address);

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    assert.equal(
      (await steth.balanceOf(await signer3.getAddress())).toString(),
      "505394238135474681"
    );
  });

  it("Queues up a vault withdraw from WBTC (erc20) vault to creditor", async () => {
    assert.equal(
      (await wbtc.balanceOf(await signer4.getAddress())).toString(),
      "0"
    );

    await wbtcCallVault.connect(signer4).maxRedeem();

    const balance = (
      await wbtcCallVault.shares(await signer4.getAddress())
    ).toString();

    assert.equal(balance, "11199759");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    await setOpynOracleExpiryPrice(
      WBTC_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract,
      await wbtcPriceSigner.getAddress(),
      await getCurrentOptionExpiry(wbtcCallVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(wbtcCallVault, strikeSelectionWBTC);

    await wbtcCallVault.connect(signer4).approve(vaultQueue.address, balance);

    await vaultQueue
      .connect(signer4)
      .queueTransfer(
        wbtcCallVault.address,
        wbtcCallVault.address,
        await signer4.getAddress(),
        "1",
        balance
      );

    await setOpynOracleExpiryPrice(
      WBTC_ADDRESS[CHAINID.ETH_MAINNET],
      oracleContract,
      await wbtcPriceSigner.getAddress(),
      await getCurrentOptionExpiry(wbtcCallVault),
      BigNumber.from("100000000000")
    );

    await rollToNextOption(wbtcCallVault, strikeSelectionWBTC);

    await vaultQueue.connect(keeperSigner).transfer(wbtcCallVault.address);

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    assert.equal(
      (await wbtc.balanceOf(await signer4.getAddress())).toString(),
      "11097941"
    );
  });

  // Rescue
  //
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

    assert.equal(keeperBalance, "9969969715542058388787");

    await vaultQueue
      .connect(keeperSigner)
      .rescueETH(parseEther("1"));

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );
    assert.bnGt(
      BigNumber.from(await ethers.provider.getBalance(keeperSigner.address)),
      BigNumber.from(keeperBalance).sub(parseEther("1"))
    );
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
    await steth.connect(signer1).transfer(vaultQueue.address, "10000");
    assert.equal(
      (await steth.balanceOf(await vaultQueue.address)).toString(),
      "9999"
    );

    await vaultQueue.connect(keeperSigner).rescue(steth.address, "1000");

    assert.equal(
      (await steth.balanceOf(await vaultQueue.address)).toString(),
      "8999"
    );
  });

  it("rescue() fails for wrong owner", async () => {
    await steth.connect(signer1).transfer(vaultQueue.address, "10");
    assert.equal(
      (await steth.balanceOf(await vaultQueue.address)).toString(),
      "9"
    );
    await expect(
      vaultQueue.connect(signer1).rescue(await steth.address, "9")
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });
});

describe("VaultQueue - AVAX -> sAVAX", () => {
  if (network.config.chainId !== CHAINID.AVAX_MAINNET) return;

  let signer1: JsonRpcSigner;
  let keeperSigner: SignerWithAddress,
    ownerSigner: JsonRpcSigner,
    wethPriceSigner: JsonRpcSigner;
  let vaultQueue: Contract,
    ethCallVault: Contract,
    stethCallVault: Contract,
    stakingHelper: Contract;
  let oracleContract: Contract, strikeSelectionETH: Contract;

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
    await vaultQueue.initialize(ethCallVault.address, keeperSigner.address, NULL_ADDR);

    ethCallVault = await ethers.getContractAt(
      AVAX_RibbonThetaVaultLogic.abi,
      AVAX_RibbonThetaVaultETHCall.address
    );

    stethCallVault = await ethers.getContractAt(
      AVAX_RibbonThetaVaultLogic.abi,
      AVAX_RibbonThetaVaultSAVAXCall.address
    );

    ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.AVAX_MAINNET]);
    wethPriceSigner = await impersonate(SAVAX_PRICER);

    oracleContract = await ethers.getContractAt(
      "IOracle",
      GAMMA_ORACLE[CHAINID.AVAX_MAINNET]
    );
    strikeSelectionETH = await ethers.getContractAt(
      AVAX_StrikeSelectionETH.abi,
      AVAX_StrikeSelectionETH.address,
      ownerSigner
    );

    await forceSend(await wethPriceSigner.getAddress(), "10");
    await sendEth(await ownerSigner.getAddress(), "10");
  });

  it("Queues up a vault transfer from AVAX vault to SAVAX vault", async () => {
    assert.equal(
      (await ethCallVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await ethCallVault.connect(signer1).maxRedeem();

    const balance = (
      await ethCallVault.shares(await signer1.getAddress())
    ).toString();
    assert.equal(balance, "60077571663919879198");

    await setOpynOracleExpiryPrice(
      SAVAX_ADDRESS[CHAINID.AVAX_MAINNET],
      oracleContract,
      await wethPriceSigner.getAddress(),
      await getCurrentOptionExpiry(ethCallVault),
      BigNumber.from("7125324071")
    );

    await rollToNextOption(ethCallVault, strikeSelectionETH);

    await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

    const queueTransferTx = await vaultQueue
      .connect(signer1)
      .queueTransfer(
        ethCallVault.address,
        stethCallVault.address,
        stakingHelper.address,
        "0",
        balance
      );

    assert.equal(
      (await ethCallVault.balanceOf(await signer1.getAddress())).toString(),
      "0"
    );

    await expect(queueTransferTx)
      .to.emit(ethCallVault, "InitiateWithdraw")
      .withArgs(vaultQueue.address, balance, "16");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );

    await setOpynOracleExpiryPrice(
      SAVAX_ADDRESS[CHAINID.AVAX_MAINNET],
      oracleContract,
      await wethPriceSigner.getAddress(),
      await getCurrentOptionExpiry(ethCallVault),
      BigNumber.from("7125324071")
    );

    await rollToNextOption(ethCallVault, strikeSelectionETH);

    const interVaultTransferTx = await vaultQueue
      .connect(keeperSigner)
      .transfer();

    await expect(interVaultTransferTx)
      .to.emit(ethCallVault, "Withdraw")
      .withArgs(vaultQueue.address, "59975246775152228377", balance);

    await expect(interVaultTransferTx)
      .to.emit(stethCallVault, "Deposit")
      .withArgs(await signer1.getAddress(), "59615196604141846696", "4");

    assert.equal(
      (await ethers.provider.getBalance(vaultQueue.address)).toString(),
      "0"
    );
  });
});
