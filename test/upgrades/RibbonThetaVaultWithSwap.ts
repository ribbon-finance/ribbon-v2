import { ethers, network } from "hardhat";
import {
  CHAINLINK_WETH_PRICER,
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  MARGIN_POOL,
  OPTION_PROTOCOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/constants";
import { objectEquals, parseLog, serializeMap, setOpynOracleExpiryPrice, setupOracle } from "../helpers/utils";
import deployments from "../../constants/deployments.json";
import { BigNumberish, Contract } from "ethers";
import * as time from "../helpers/time";
import { assert } from "../helpers/assertions";
import { BigNumber } from "ethereum-waffle/node_modules/ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { expect } from "chai";
import { parseUnits } from "ethers/lib/utils";

const { parseEther } = ethers.utils;

const UPGRADE_ADMIN = "0x223d59FA315D7693dF4238d1a5748c964E615923";
const KEEPER = "0x55e4b3e3226444Cd4de09778844453bA9fe9cd7c";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const USER_ACCOUNT_1 = "0xbA304E6d2bBb7Bc84a247693E34Be1bed2e2cCc2";
const USER_ACCOUNT_2 = "0xc9596e90ea2b30159889F1883077609eec048dB7";

// UPDATE THESE VALUES BEFORE WE ATTEMPT AN UPGRADE
const FORK_BLOCK = 14709786;

const CHAINID = process.env.CHAINID ? Number(process.env.CHAINID) : 1;

describe("RibbonThetaVault upgrade", () => {
  let vaults: string[] = [];

  before(async function () {
    // We need to checkpoint the contract on mainnet to a past block before the upgrade happens
    // This means the `implementation` is pointing to an old contract
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

    // Fund & impersonate the admin account
    const [userSigner] = await ethers.getSigners();

    await userSigner.sendTransaction({
      to: UPGRADE_ADMIN,
      value: parseEther("10"),
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [UPGRADE_ADMIN],
    });

    const deploymentNames = [
      "RibbonThetaVaultETHCall",
      "RibbonThetaVaultWBTCCall",
      "RibbonThetaVaultAAVECall",
      "RibbonThetaVaultAPECall",
    ];
    deploymentNames.forEach((name) => vaults.push(deployments.mainnet[name]));
  });

  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultETHCall);
  checkWithdrawal(deployments.mainnet.RibbonThetaVaultETHCall);
  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultWBTCCall);
  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultAAVECall);
  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultAPECall);
});

function checkWithdrawal(vaultAddress: string) {
  describe(`Vault ${vaultAddress}`, () => {
    let newImplementation: string;
    let vaultProxy: Contract;
    let vault: Contract;

    time.revertToSnapshotAfterEach();

    before(async () => {
      const adminSigner = await ethers.provider.getSigner(UPGRADE_ADMIN);

      vaultProxy = await ethers.getContractAt(
        "AdminUpgradeabilityProxy",
        vaultAddress,
        adminSigner
      );
      vault = await ethers.getContractAt("RibbonThetaVaultWithSwap", vaultAddress);

      const VaultLifecycle = await ethers.getContractFactory("VaultLifecycleWithSwap");
      const vaultLifecycleLib = await VaultLifecycle.deploy();

      const Swap = await ethers.getContractFactory("Swap");
      const SwapContract = await Swap.deploy();

      const RibbonThetaVault = await ethers.getContractFactory(
        "RibbonThetaVaultWithSwap",
        {
          libraries: {
            VaultLifecycleWithSwap: vaultLifecycleLib.address,
          },
        }
      );

      const newImplementationContract = await RibbonThetaVault.deploy(
        WETH_ADDRESS[CHAINID],
        USDC_ADDRESS[CHAINID],
        OTOKEN_FACTORY[CHAINID],
        GAMMA_CONTROLLER[CHAINID],
        MARGIN_POOL[CHAINID],
        SwapContract.address
      );
      newImplementation = newImplementationContract.address;
    });

    describe("#completeWithdraw", () => {
      time.revertToSnapshotAfterEach();
      let account1: SignerWithAddress;
      let account2: SignerWithAddress;
      let keeper: SignerWithAddress;
      let liquidityGauge: Contract;
      let asset: Contract;

      beforeEach(async function () {
        await vaultProxy.upgradeTo(newImplementation);
        // For withdrawal testing
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [USER_ACCOUNT_1],
        });

        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [USER_ACCOUNT_2],
        });

        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [KEEPER],
        });

        account1 = await ethers.getSigner(USER_ACCOUNT_1);
        account2 = await ethers.getSigner(USER_ACCOUNT_2);
        keeper = await ethers.getSigner(KEEPER);

        const liquidityGaugeAddress = await vault.liquidityGauge();
        liquidityGauge = await ethers.getContractAt("ILiquidityGauge", liquidityGaugeAddress);

        const assetAddress = (await vault.vaultParams()).asset;
        asset = await ethers.getContractAt("IERC20", assetAddress);
      });

      it("withdraws the correct amount after upgrade", async () => {
        // Get the staked vault shares of the users
        const acc1StakedBalance = await liquidityGauge.balanceOf(account1.address);
        const acc2StakedBalance = await liquidityGauge.balanceOf(account2.address);

        // Withdraw the staked balance of the users
        await liquidityGauge.connect(account1).withdraw(acc1StakedBalance);
        await liquidityGauge.connect(account2).withdraw(acc2StakedBalance);

        // Get the initial share balance of the users
        const initialAcc1ShareBalance = await vault.shares(account1.address);
        const initialAcc2ShareBalance = await vault.shares(account2.address);

        // Initiate withdrawal
        await vault
          .connect(account1)
          .initiateWithdraw(initialAcc1ShareBalance);
        await vault
          .connect(account2)
          .initiateWithdraw(initialAcc2ShareBalance);

        // Get balance after initiate withdraw
        const acc1ShareBalanceAfterInit = await vault.shares(account1.address);
        const acc2ShareBalanceAfterInit = await vault.shares(account2.address);

        // Ensure share balance remains the same
        assert.bnEqual(acc1ShareBalanceAfterInit, BigNumber.from(0));
        assert.bnEqual(acc2ShareBalanceAfterInit, BigNumber.from(0));

        // Roll the vault
        const oracle = await setupOracle(
          asset.address,
          CHAINLINK_WETH_PRICER[CHAINID],
          account1,
          OPTION_PROTOCOL.GAMMA
        );

        const currentOption = await vault.currentOption();
        const otoken = await ethers.getContractAt("IOtoken", currentOption);
        const expiryTimestamp = await otoken.expiryTimestamp();
        const strikePrice = await otoken.strikePrice();

        await setOpynOracleExpiryPrice(
          asset.address,
          oracle,
          expiryTimestamp,
          strikePrice
        );

        await vault.connect(keeper).closeRound();

        // Get the initiate asset balance of the users
        const acc1AssetBalanceBefore = await account1.getBalance();
        const acc2AssetBalanceBefore = await account2.getBalance();

        // Ensure the correct balance is withdrawn
        const currentRound = (await vault.vaultState()).round;
        const pps = await vault.roundPricePerShare(currentRound - 1);

        // Complete withdrawal
        const gasPrice = parseUnits("30", "gwei");

        const acc1Tx = await vault.connect(account1).completeWithdraw({ gasPrice });
        const acc1Receipt = await acc1Tx.wait();
        const acc1GasFee = acc1Receipt.gasUsed.mul(gasPrice);

        const acc2Tx = await vault.connect(account2).completeWithdraw({ gasPrice });
        const acc2Receipt = await acc2Tx.wait();
        const acc2GasFee = acc2Receipt.gasUsed.mul(gasPrice);

        await expect(acc1Tx).to.emit(vault, "Withdraw").withArgs(
          account1.address,
          initialAcc1ShareBalance.mul(pps).div(parseEther("1")),
          initialAcc1ShareBalance
        );

        await expect(acc2Tx).to.emit(vault, "Withdraw").withArgs(
          account2.address,
          initialAcc2ShareBalance.mul(pps).div(parseEther("1")),
          initialAcc2ShareBalance
        );

        // Get the users balance
        const acc1AssetBalanceAfter = await account1.getBalance();
        const acc2AssetBalanceAfter = await account2.getBalance();

        assert.bnGte(acc1AssetBalanceAfter.sub(acc1AssetBalanceBefore), initialAcc1ShareBalance.mul(pps).div(parseEther("1")).sub(acc1GasFee));
        assert.bnGte(acc2AssetBalanceAfter.sub(acc2AssetBalanceBefore), initialAcc2ShareBalance.mul(pps).div(parseEther("1")).sub(acc2GasFee));
      });
    });
  });
}

function checkIfStorageNotCorrupted(vaultAddress: string) {
  const getVaultStorage = async (storageIndex: BigNumberish) => {
    return await ethers.provider.getStorageAt(vaultAddress, storageIndex);
  };

  const variableNames = [
    "vaultParams",
    "vaultState",
    "optionState",
    "feeRecipient",
    "keeper",
    "performanceFee",
    "managementFee",
    "optionsPremiumPricer",
    "strikeSelection",
    "premiumDiscount",
    "currentOtokenPremium",
    "lastStrikeOverrideRound",
    "overriddenStrikePrice",
    "auctionDuration",
    "optionAuctionID",
    "lastQueuedWithdrawAmount",
    "liquidityGauge",
    "optionsPurchaseQueue",
  ];

  const newVariables = ["currentQueuedWithdrawShares"];

  let variables: Record<string, unknown> = {};

  describe(`Vault ${vaultAddress}`, () => {
    let newImplementation: string;
    let vaultProxy: Contract;
    let vault: Contract;

    time.revertToSnapshotAfterEach();

    before(async () => {
      const adminSigner = await ethers.provider.getSigner(UPGRADE_ADMIN);

      vaultProxy = await ethers.getContractAt(
        "AdminUpgradeabilityProxy",
        vaultAddress,
        adminSigner
      );
      vault = await ethers.getContractAt("RibbonThetaVault", vaultAddress);

      variables = await getVariablesFromContract(vault);

      const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
      const vaultLifecycleLib = await VaultLifecycle.deploy();

      const RibbonThetaVault = await ethers.getContractFactory(
        "RibbonThetaVault",
        {
          libraries: {
            VaultLifecycle: vaultLifecycleLib.address,
          },
        }
      );

      const newImplementationContract = await RibbonThetaVault.deploy(
        WETH_ADDRESS[CHAINID],
        USDC_ADDRESS[CHAINID],
        OTOKEN_FACTORY[CHAINID],
        GAMMA_CONTROLLER[CHAINID],
        MARGIN_POOL[CHAINID],
        GNOSIS_EASY_AUCTION[CHAINID]
      );
      newImplementation = newImplementationContract.address;
    });

    it("has the correct return values for all public variables", async () => {
      await vaultProxy.upgradeTo(newImplementation);
      const newVariables = await getVariablesFromContract(vault);
      assert.isTrue(
        objectEquals(variables, newVariables),
        `Public variables do not match:
Old: ${JSON.stringify(variables, null, 4)}
New: ${JSON.stringify(newVariables, null, 4)}`
      );
    });

    it("updates the implementation slot correctly after an upgrade", async () => {
      const res = await vaultProxy.upgradeTo(newImplementation);

      const receipt = await res.wait();

      const log = await parseLog("AdminUpgradeabilityProxy", receipt.logs[0]);
      assert.equal(log.args.implementation, newImplementation);
      assert.equal(
        await getVaultStorage(IMPLEMENTATION_SLOT),
        "0x000000000000000000000000" + newImplementation.slice(2).toLowerCase()
      );
    });

    it("shows the new variables correctly after an upgrade", async () => {
      const res = await vaultProxy.upgradeTo(newImplementation);
      await res.wait();

      const variableReturns = await Promise.all(
        newVariables.map((varName) => vault[varName]())
      );
      for (let returnVal of variableReturns) {
        assert.bnEqual(returnVal, BigNumber.from(0));
      }
    });

    const getVariablesFromContract = async (vault: Contract) => {
      // get contract values with solidity getter
      const variableReturns = await Promise.all(
        variableNames.map((varName) => vault[varName]())
      );
      const variables = Object.fromEntries(
        variableNames.map((varName, index) => [varName, variableReturns[index]])
      );
      return serializeMap(variables);
    };
  });
}
