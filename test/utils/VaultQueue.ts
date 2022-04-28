import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, constants, Contract } from "ethers";
import { JsonRpcSigner } from "@ethersproject/providers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "../helpers/assertions";
import { increaseTo } from "../helpers/time";
import {
  CHAINID,
  CHAINLINK_WETH_PRICER,
  CHAINLINK_WBTC_PRICER,
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

import ETH_StrikeSelectionETH from "../../deployments/mainnet/StrikeSelectionETHCall.json";
import ETH_StrikeSelectionWBTC from "../../deployments/mainnet/StrikeSelectionWBTCCall.json";

import AVAX_RibbonThetaVaultLogic from "../../deployments/avax/RibbonThetaVaultLogic.json";
import AVAX_RibbonThetaVaultETHCall from "../../deployments/avax/RibbonThetaVaultETHCall.json";
import AVAX_RibbonThetaVaultSAVAXCall from "../../deployments/avax/RibbonThetaVaultSAVAXCall.json";
import * as time from "../helpers/time";

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
  let oracleContract: Contract,
    strikeSelectionETH: Contract,
    strikeSelectionWBTC: Contract;
  let steth: Contract, wbtc: Contract;

  before(async () => {
    await resetBlock(process.env.MAINNET_URI, 14671659);

    // Nothing special about this user other than he's a depositor that has not redeemed any shares.
    // Randomly selected a depositor from the vault transaction history to mock.
    const MOCK_USER_1 = "0x267a3195ea57ad38E65993DBcB9FBebf8995621D"; // eth deposited in eth call vault
    const MOCK_USER_2 = "0xa13d074fe7f27a1a126892e636a22a12d19e6858"; // eth call vault
    const MOCK_USER_3 = "0x35bb7ab3956738e0b6e9e1cbc1732d357bee9793"; // stETH call vault
    const MOCK_USER_4 = "0x82738b0ebc1d667765cb9cdeb4a2a96da6e6a77a"; // wbtc call vault
    const MOCK_USER_5 = "0xe2e96c461df0cdb5300640feaebf9f145adcd709"; // eth call vault

    signer1 = await impersonate(MOCK_USER_1);
    signer2 = await impersonate(MOCK_USER_2);
    signer3 = await impersonate(MOCK_USER_3);
    signer4 = await impersonate(MOCK_USER_4);
    signer5 = await impersonate(MOCK_USER_5);
    ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.ETH_MAINNET]);

    wethPriceSigner = await impersonate(
      CHAINLINK_WETH_PRICER[CHAINID.ETH_MAINNET]
    );
    wstethPriceSigner = await impersonate(WSTETH_PRICER);
    wbtcPriceSigner = await impersonate(
      CHAINLINK_WBTC_PRICER[CHAINID.ETH_MAINNET]
    );

    [keeperSigner] = await ethers.getSigners();

    await sendEth(await signer1.getAddress(), "1");
    await sendEth(await signer2.getAddress(), "1");
    await sendEth(await signer3.getAddress(), "1");
    await sendEth(await signer4.getAddress(), "1");
    await sendEth(await signer5.getAddress(), "1");
    await sendEth(await ownerSigner.getAddress(), "10");

    // Load up addresses with ETH for gas
    await forceSend(await wethPriceSigner.getAddress(), "10");
    await forceSend(await wstethPriceSigner.getAddress(), "10");
    await forceSend(await wbtcPriceSigner.getAddress(), "10");

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
    vaultQueue = await VaultQueue.deploy(
      ethCallVault.address,
      stethCallVault.address
    );
    await vaultQueue.connect(ownerSigner).initialize();

    ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.ETH_MAINNET]);
    wethPriceSigner = await impersonate(
      CHAINLINK_WETH_PRICER[CHAINID.ETH_MAINNET]
    );
    wstethPriceSigner = await impersonate(WSTETH_PRICER);
    wbtcPriceSigner = await impersonate(
      CHAINLINK_WBTC_PRICER[CHAINID.ETH_MAINNET]
    );

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
    wbtc = await ethers.getContractAt(
      "ERC20",
      WBTC_ADDRESS[CHAINID.ETH_MAINNET]
    );

    // Load up addresses with ETH for gas
    await forceSend(await wethPriceSigner.getAddress(), "10");
    await forceSend(await wstethPriceSigner.getAddress(), "10");
    await forceSend(await wbtcPriceSigner.getAddress(), "10");
    await sendEth(await ownerSigner.getAddress(), "10");

    await vaultQueue
      .connect(ownerSigner)
      .setDepositContract(stethCallVault.address, true);

    await vaultQueue.connect(ownerSigner).setKeeper(keeperSigner.address);
  });

  describe("VaultQueue - ETH -> stETH", () => {
    time.revertToSnapshotAfterEach();

    it("reverts when non-owner calls setDepositContract", async () => {
      await expect(
        vaultQueue.connect(signer1).setDepositContract(steth.address, true)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts when non-owner calls setQueueSize", async () => {
      await expect(
        vaultQueue.connect(signer1).setQueueSize(64)
      ).to.be.revertedWith("Ownable: caller is not the owner");
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
      assert.equal(balance, "1006485810884633466");

      await setOpynOracleExpiryPrice(
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        oracleContract,
        await wethPriceSigner.getAddress(),
        await getCurrentOptionExpiry(ethCallVault),
        BigNumber.from("272655342834")
      );

      await rollToNextOption(ethCallVault, strikeSelectionETH);

      await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

      const queueTransferTx = await vaultQueue
        .connect(signer1)
        .queueTransfer(
          ethCallVault.address,
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
        .withArgs(vaultQueue.address, balance, "35");

      assert.equal(
        (await ethers.provider.getBalance(vaultQueue.address)).toString(),
        "0"
      );

      await setOpynOracleExpiryPrice(
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        oracleContract,
        await wethPriceSigner.getAddress(),
        await getCurrentOptionExpiry(ethCallVault),
        BigNumber.from("272655342834")
      );

      await rollToNextOption(ethCallVault, strikeSelectionETH);

      const interVaultTransferTx = await vaultQueue
        .connect(keeperSigner)
        .transfer(ethCallVault.address);

      await expect(interVaultTransferTx)
        .to.emit(ethCallVault, "Withdraw")
        .withArgs(vaultQueue.address, "1108806555316160772", balance);

      await expect(interVaultTransferTx)
        .to.emit(stethCallVault, "Deposit")
        .withArgs(await signer1.getAddress(), "1108806555316160772", "24");

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
          "0",
          balance1
        );

      await ethCallVault.connect(signer2).approve(vaultQueue.address, balance2);
      await vaultQueue
        .connect(signer2)
        .queueTransfer(
          ethCallVault.address,
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
          "0",
          balance3
        );

      await setOpynOracleExpiryPrice(
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        oracleContract,
        await wethPriceSigner.getAddress(),
        await getCurrentOptionExpiry(ethCallVault),
        BigNumber.from("272655342834")
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
          "107140503169183205197",
          "97253570240730797358"
        );

      await expect(interVaultTransferTx)
        .to.emit(stethCallVault, "Deposit")
        .withArgs(await signer1.getAddress(), "1108806555316160762", "24");

      await expect(interVaultTransferTx)
        .to.emit(stethCallVault, "Deposit")
        .withArgs(await signer2.getAddress(), "102801807869008328", "24");

      await expect(interVaultTransferTx)
        .to.emit(stethCallVault, "Deposit")
        .withArgs(await signer5.getAddress(), "105928894805998036107", "24");
    });

    it("Queues up vault transfer from ETH vault to stETH vault 3x", async () => {
      const vaultTransfer = async (signer: JsonRpcSigner) => {
        await ethCallVault.connect(signer).maxRedeem();

        const balance = (
          await ethCallVault.shares(await signer.getAddress())
        ).toString();

        await ethCallVault.connect(signer).approve(vaultQueue.address, balance);
        await vaultQueue
          .connect(signer)
          .queueTransfer(
            ethCallVault.address,
            stethCallVault.address,
            "0",
            balance
          );

        await setOpynOracleExpiryPrice(
          WETH_ADDRESS[CHAINID.ETH_MAINNET],
          oracleContract,
          await wethPriceSigner.getAddress(),
          await getCurrentOptionExpiry(ethCallVault),
          BigNumber.from("272655342834")
        );

        await rollToNextOption(ethCallVault, strikeSelectionETH);

        const interVaultTransferTx = await vaultQueue
          .connect(keeperSigner)
          .transfer(ethCallVault.address);

        return interVaultTransferTx;
      };

      const interVaultTransferTx1 = await vaultTransfer(signer1);
      const interVaultTransferTx2 = await vaultTransfer(signer2);
      const interVaultTransferTx3 = await vaultTransfer(signer5);

      await expect(interVaultTransferTx1)
        .to.emit(stethCallVault, "Deposit")
        .withArgs(await signer1.getAddress(), "1108806555316160772", "24");

      await expect(interVaultTransferTx2)
        .to.emit(stethCallVault, "Deposit")
        .withArgs(await signer2.getAddress(), "102801807869008348", "24");

      // Appears extra shared were minted for signer5
      await expect(interVaultTransferTx3)
        .to.emit(stethCallVault, "Deposit")
        .withArgs(await signer5.getAddress(), "107730971775998036075", "24");
    });

    //
    // Withdrawal
    ///
    // it("Doesn't allow the same user to queue up multiple withdrawals", async () => {
    //   await ethCallVault.connect(signer1).maxRedeem();
    //   const balance = (
    //     await ethCallVault.shares(await signer1.getAddress())
    //   ).toString();
    //   await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

    //   assert.isFalse(await vaultQueue.hasWithdrawal(ethCallVault.address, await signer1.getAddress()));

    //   await vaultQueue
    //     .connect(signer1)
    //     .queueTransfer(
    //       ethCallVault.address,
    //       stethCallVault.address,
    //       "0",
    //       "1000"
    //     );

    //   assert.isTrue(await vaultQueue.hasWithdrawal(ethCallVault.address, await signer1.getAddress()));

    //   await expect(
    //     vaultQueue
    //       .connect(signer1)
    //       .queueTransfer(
    //         ethCallVault.address,
    //         stethCallVault.address,
    //         "0",
    //         "1000"
    //       )
    //   ).to.be.revertedWith("Withdraw already submitted");
    // });

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
        BigNumber.from("272655342834")
      );

      await rollToNextOption(ethCallVault, strikeSelectionETH);

      await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

      await vaultQueue
        .connect(signer1)
        .queueTransfer(
          ethCallVault.address,
          constants.AddressZero,
          "1",
          balance
        );
    });

    //
    // Withdrawal
    ///
    it("Doesn't allow the same user to queue up multiple withdrawals", async () => {
      await ethCallVault.connect(signer1).maxRedeem();
      const balance = (
        await ethCallVault.shares(await signer1.getAddress())
      ).toString();
      await ethCallVault.connect(signer1).approve(vaultQueue.address, balance);

      assert.isFalse(
        await vaultQueue.hasWithdrawal(
          ethCallVault.address,
          await signer1.getAddress()
        )
      );

      await vaultQueue
        .connect(signer1)
        .queueTransfer(
          ethCallVault.address,
          stethCallVault.address,
          stethCallVault.address,
          "1000"
        );

      assert.isTrue(
        await vaultQueue.hasWithdrawal(
          ethCallVault.address,
          await signer1.getAddress()
        )
      );

      await expect(
        vaultQueue
          .connect(signer1)
          .queueTransfer(
            ethCallVault.address,
            stethCallVault.address,
            stethCallVault.address,
            "1000"
          )
      ).to.be.revertedWith("Withdraw already submitted");
    });

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
        BigNumber.from("272655342834")
      );

      await rollToNextOption(ethCallVault, strikeSelectionETH);

      assert.isAtLeast(
        Number(
          (
            await ethers.provider.getBalance(await signer1.getAddress())
          ).toString()
        ),
        Number("1640843000000000000")
      );

      await vaultQueue.connect(keeperSigner).transfer(ethCallVault.address);

      assert.equal(
        (await ethers.provider.getBalance(vaultQueue.address)).toString(),
        "0"
      );

      assert.isAtLeast(
        Number(
          (
            await ethers.provider.getBalance(await signer1.getAddress())
          ).toString()
        ),
        Number("1640843000000000000")
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
            BigNumber.from("272655342834")
          );

        const res = await oracleContract
          .connect(wethPriceSigner)
          .setExpiryPrice(
            WETH_ADDRESS[CHAINID.ETH_MAINNET],
            expiry,
            BigNumber.from("272655342834")
          );
      };

      assert.isAtLeast(
        Number(
          (
            await ethers.provider.getBalance(await signer1.getAddress())
          ).toString()
        ),
        Number("1640843000000000000")
      );

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

      await stethCallVault
        .connect(signer3)
        .approve(vaultQueue.address, balance);

      await vaultQueue
        .connect(signer3)
        .queueTransfer(
          stethCallVault.address,
          await signer3.getAddress(),
          "1",
          balance
        );

      assert.equal(
        (await stethCallVault.balanceOf(await signer3.getAddress())).toString(),
        "0"
      );

      await vaultQueue
        .connect(signer3)
        .queueTransfer(
          stethCallVault.address,
          await signer3.getAddress(),
          "1",
          balance
        );

      assert.equal(
        (await stethCallVault.balanceOf(await signer3.getAddress())).toString(),
        "0"
      );

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
        BigNumber.from("272655342834")
      );

      await rollToNextOption(wbtcCallVault, strikeSelectionWBTC);

      await wbtcCallVault.connect(signer4).approve(vaultQueue.address, balance);

      await vaultQueue
        .connect(signer4)
        .queueTransfer(
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
        BigNumber.from("272655342834")
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

    it("Queues up partial vault withdraw from ETH vault to creditor vault", async () => {
      const amountToWithdraw = parseEther(".001");
      const queueWithdrawal = async (signer: JsonRpcSigner) => {
        await ethCallVault.connect(signer).maxRedeem();

        await ethCallVault
          .connect(signer)
          .approve(vaultQueue.address, amountToWithdraw);
        await vaultQueue
          .connect(signer)
          .queueTransfer(
            ethCallVault.address,
            await signer.getAddress(),
            "1",
            amountToWithdraw
          );
      };

      await queueWithdrawal(signer1);
      await queueWithdrawal(signer2);

      await setOpynOracleExpiryPrice(
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        oracleContract,
        await wethPriceSigner.getAddress(),
        await getCurrentOptionExpiry(ethCallVault),
        BigNumber.from("272655342834")
      );

      await rollToNextOption(ethCallVault, strikeSelectionETH);

      await vaultQueue.connect(keeperSigner).rescueETH(parseEther("1"));
      const interVaultTransferTx1 = await vaultQueue
        .connect(keeperSigner)
        .transfer(ethCallVault.address);

      await queueWithdrawal(signer5);

      await setOpynOracleExpiryPrice(
        WETH_ADDRESS[CHAINID.ETH_MAINNET],
        oracleContract,
        await wethPriceSigner.getAddress(),
        await getCurrentOptionExpiry(ethCallVault),
        BigNumber.from("272655342834")
      );

      await rollToNextOption(ethCallVault, strikeSelectionETH);

      const interVaultTransferTx2 = await vaultQueue
        .connect(keeperSigner)
        .transfer(ethCallVault.address);

      // Withdraw amount events are the same because the amount is fixed at .001 eth
      const WITHDRAW_AMOUNT = BigNumber.from("1076049895034363");
      await expect(interVaultTransferTx1)
        .to.emit(ethCallVault, "Withdraw")
        .withArgs(
          vaultQueue.address,
          WITHDRAW_AMOUNT.mul(2).toString(),
          amountToWithdraw.mul(2).toString()
        );

      await expect(interVaultTransferTx2)
        .to.emit(ethCallVault, "Withdraw")
        .withArgs(
          vaultQueue.address,
          WITHDRAW_AMOUNT.toString(),
          amountToWithdraw.toString()
        );

      await expect(interVaultTransferTx1).to.emit(vaultQueue, "Disburse");

      await expect(interVaultTransferTx2).to.emit(vaultQueue, "Disburse");
    });

    //
    // Payable
    ///
    it("user can't pay contract", async () => {
      await expect(
        signer1.sendTransaction({
          to: vaultQueue.address,
          value: parseEther("1"),
        })
      ).to.be.revertedWith("Invalid sender");
    });
  });

  describe("VaultQueue - AVAX -> sAVAX", () => {
    if (network.config.chainId !== CHAINID.AVAX_MAINNET) return;

    let signer1: JsonRpcSigner;
    let keeperSigner: SignerWithAddress,
      ownerSigner: JsonRpcSigner,
      avaxPriceSigner: JsonRpcSigner;
    let vaultQueue: Contract,
      avaxCallVault: Contract,
      savaxCallVault: Contract,
      stakingHelper: Contract;
    let oracleContract: Contract, strikeSelectionETH: Contract;

    beforeEach(async () => {
      await resetBlock(process.env.AVAX_URI, 12900000);

      const MOCK_USER_1 = "0xc415f079430687a2692c719b63eb1fb795785fb1";

      signer1 = await impersonate(MOCK_USER_1);

      [keeperSigner] = await ethers.getSigners();

      await sendEth(await signer1.getAddress(), "10");

      const StakingHelper = await ethers.getContractFactory(
        "SAVAXDepositHelper"
      );
      stakingHelper = await StakingHelper.deploy(
        SAVAX_ADDRESS[CHAINID.AVAX_MAINNET],
        AVAX_RibbonThetaVaultSAVAXCall.address
      );

      avaxCallVault = await ethers.getContractAt(
        AVAX_RibbonThetaVaultLogic.abi,
        AVAX_RibbonThetaVaultETHCall.address
      );

      savaxCallVault = await ethers.getContractAt(
        AVAX_RibbonThetaVaultLogic.abi,
        AVAX_RibbonThetaVaultSAVAXCall.address
      );

      const VaultQueue = await ethers.getContractFactory("VaultQueue");
      vaultQueue = await VaultQueue.deploy(
        avaxCallVault.address,
        keeperSigner.address
      );
      await vaultQueue.initialize();

      ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.AVAX_MAINNET]);
      avaxPriceSigner = await impersonate(
        CHAINLINK_WETH_PRICER[CHAINID.AVAX_MAINNET]
      );

      ownerSigner = await impersonate(ORACLE_OWNER[CHAINID.AVAX_MAINNET]);
      avaxPriceSigner = await impersonate(
        CHAINLINK_WETH_PRICER[CHAINID.AVAX_MAINNET]
      );

      await forceSend(await avaxPriceSigner.getAddress(), "10");
      await sendEth(await ownerSigner.getAddress(), "10");
    });

    it("Queues up a vault transfer from AVAX vault to SAVAX vault", async () => {
      assert.equal(
        (await avaxCallVault.balanceOf(await signer1.getAddress())).toString(),
        "0"
      );
    });

    it("Queues up a vault transfer from AVAX vault to SAVAX vault", async () => {
      assert.equal(
        (await avaxCallVault.balanceOf(await signer1.getAddress())).toString(),
        "0"
      );

      const balance = (
        await avaxCallVault.shares(await signer1.getAddress())
      ).toString();
      assert.equal(balance, "68576128256652567125");

      await setOpynOracleExpiryPrice(
        WETH_ADDRESS[CHAINID.AVAX_MAINNET],
        oracleContract,
        await avaxPriceSigner.getAddress(),
        await getCurrentOptionExpiry(avaxCallVault),
        BigNumber.from("7125324071")
      );

      await rollToNextOption(avaxCallVault, strikeSelectionETH);

      await avaxCallVault.connect(signer1).approve(vaultQueue.address, balance);

      const queueTransferTx = await vaultQueue
        .connect(signer1)
        .queueTransfer(
          avaxCallVault.address,
          savaxCallVault.address,
          stakingHelper.address,
          "0",
          balance
        );

      assert.equal(
        (await avaxCallVault.balanceOf(await signer1.getAddress())).toString(),
        "0"
      );

      await expect(queueTransferTx)
        .to.emit(avaxCallVault, "InitiateWithdraw")
        .withArgs(vaultQueue.address, balance, "20");

      assert.equal(
        (await ethers.provider.getBalance(vaultQueue.address)).toString(),
        "0"
      );

      await setOpynOracleExpiryPrice(
        WETH_ADDRESS[CHAINID.AVAX_MAINNET],
        oracleContract,
        await avaxPriceSigner.getAddress(),
        await getCurrentOptionExpiry(avaxCallVault),
        BigNumber.from("7125324071")
      );

      await rollToNextOption(avaxCallVault, strikeSelectionETH);

      const interVaultTransferTx = await vaultQueue
        .connect(keeperSigner)
        .transfer(avaxCallVault.address);

      await expect(interVaultTransferTx)
        .to.emit(avaxCallVault, "Withdraw")
        .withArgs(vaultQueue.address, "69254958827799082840", balance);

      await expect(interVaultTransferTx)
        .to.emit(savaxCallVault, "Deposit")
        .withArgs(await signer1.getAddress(), "68663108358204122414", "7");

      assert.equal(
        (await ethers.provider.getBalance(vaultQueue.address)).toString(),
        "0"
      );
    });
  });
});
