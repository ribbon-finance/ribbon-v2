import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import {
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
  WSTETH_ADDRESS,
  LDO_ADDRESS,
  STETH_ETH_CRV_POOL,
  CHAINLINK_WETH_PRICER_STETH,
  WSTETH_PRICER,
  YEARN_PRICER_OWNER,
  STETH_ADDRESS,
  OPTION_PROTOCOL,
} from "../../constants/constants";
import {
  objectEquals,
  parseLog,
  serializeMap,
  setOpynOracleExpiryPriceYearn,
  setupOracle,
  getAssetPricer,
} from "../helpers/utils";
import { assert } from "../helpers/assertions";
import deployments from "../../constants/deployments.json";
import { BigNumberish, Contract } from "ethers";
import * as time from "../helpers/time";

const { parseEther } = ethers.utils;

const UPGRADE_ADMIN = "0x223d59FA315D7693dF4238d1a5748c964E615923";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// UPDATE THESE VALUES BEFORE WE ATTEMPT AN UPGRADE
const FORK_BLOCK = 14666955;

const TEST_USER = "0xacf9e821c7099f5ba022a7cc5341b8a3b10f0c99";

const CHAINID = process.env.CHAINID ? Number(process.env.CHAINID) : 1;

describe("RibbonThetaSTETHVault upgrade", () => {
  let newImplementation: string;
  let vaultProxy: Contract;
  let vault: Contract;
  let steth: Contract;
  let keeper: string;
  let ownerSigner: SignerWithAddress;
  let variables: Record<string, unknown> = {};

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
  ];

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
    [ownerSigner] = await ethers.getSigners();

    await ownerSigner.sendTransaction({
      to: UPGRADE_ADMIN,
      value: parseEther("10"),
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [UPGRADE_ADMIN],
    });

    await ownerSigner.sendTransaction({
      to: TEST_USER,
      value: parseEther("10"),
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TEST_USER],
    });

    const adminSigner = await ethers.provider.getSigner(UPGRADE_ADMIN);

    vaultProxy = await ethers.getContractAt(
      "AdminUpgradeabilityProxy",
      deployments.mainnet.RibbonThetaVaultSTETHCall,
      adminSigner
    );
    vault = await ethers.getContractAt(
      "RibbonThetaSTETHVault",
      deployments.mainnet.RibbonThetaVaultSTETHCall
    );

    variables = await getVariablesFromContract(vault);

    const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
    const VaultLifecycleLib = await VaultLifecycle.deploy();

    const VaultLifecycleSTETH = await ethers.getContractFactory(
      "VaultLifecycleSTETH"
    );
    const VaultLifecycleSTETHLib = await VaultLifecycleSTETH.deploy();

    const RibbonThetaSTETHVault = await ethers.getContractFactory(
      "RibbonThetaSTETHVault",
      {
        libraries: {
          VaultLifecycle: VaultLifecycleLib.address,
          VaultLifecycleSTETH: VaultLifecycleSTETHLib.address,
        },
      }
    );
    const newImplementationContract = await RibbonThetaSTETHVault.deploy(
      WETH_ADDRESS[CHAINID],
      USDC_ADDRESS[CHAINID],
      WSTETH_ADDRESS[CHAINID],
      LDO_ADDRESS,
      OTOKEN_FACTORY[CHAINID],
      GAMMA_CONTROLLER[CHAINID],
      MARGIN_POOL[CHAINID],
      GNOSIS_EASY_AUCTION[CHAINID],
      STETH_ETH_CRV_POOL
    );
    newImplementation = newImplementationContract.address;

    steth = await ethers.getContractAt("ISTETH", STETH_ADDRESS);

    keeper = await vault.keeper();

    await ownerSigner.sendTransaction({
      to: keeper,
      value: parseEther("10"),
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [keeper],
    });

    await ownerSigner.sendTransaction({
      to: YEARN_PRICER_OWNER,
      value: parseEther("10"),
    });
  });

  describe("Vault upgrade", () => {
    time.revertToSnapshotAfterEach();

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
  });

  describe("#completeWithdraw", () => {
    time.revertToSnapshotAfterEach();

    beforeEach(async function () {
      await vaultProxy.upgradeTo(newImplementation);
    });

    it("Withdraws stETH", async () => {
      const userSigner = await ethers.provider.getSigner(TEST_USER);
      const keeperSigner = await ethers.provider.getSigner(keeper);

      const collateralPricerSigner = await getAssetPricer(
        WSTETH_PRICER,
        ownerSigner
      );

      const oracle = await setupOracle(
        WETH_ADDRESS[CHAINID],
        CHAINLINK_WETH_PRICER_STETH,
        ownerSigner,
        OPTION_PROTOCOL.GAMMA
      );

      const vaultBalance = await vault.shares(TEST_USER);
      const initialWithdrawal = vaultBalance.div(2);
      const finalWithdrawal = vaultBalance.sub(initialWithdrawal);

      await vault.connect(userSigner).initiateWithdraw(initialWithdrawal);
      await setOpynOracleExpiryPriceYearn(
        WETH_ADDRESS[CHAINID],
        oracle,
        await getCurrentOptionStrike(),
        collateralPricerSigner,
        await getCurrentOptionExpiry()
      );
      await vault.connect(keeperSigner).commitAndClose();
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
      await vault.connect(keeperSigner).rollToNextOption();
      const balance0 = await steth.balanceOf(TEST_USER);
      const totalBalance0 = await vault.totalBalance();
      await vault.connect(userSigner).completeWithdraw();

      const balance1 = await steth.balanceOf(TEST_USER);
      const totalBalance1 = await vault.totalBalance();
      assert.bnGte(balance1.sub(balance0), initialWithdrawal);
      assert.bnGte(totalBalance0.sub(totalBalance1), balance1.sub(balance0));

      await vault.connect(userSigner).initiateWithdraw(finalWithdrawal);
      await setOpynOracleExpiryPriceYearn(
        WETH_ADDRESS[CHAINID],
        oracle,
        await getCurrentOptionStrike(),
        collateralPricerSigner,
        await getCurrentOptionExpiry()
      );
      await vault.connect(keeperSigner).commitAndClose();
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
      await vault.connect(keeperSigner).rollToNextOption();
      await vault.connect(userSigner).completeWithdraw();

      const balance2 = await steth.balanceOf(TEST_USER);
      const totalBalance2 = await vault.totalBalance();
      assert.bnGte(balance2.sub(balance1), finalWithdrawal);
      assert.bnGte(totalBalance1.sub(totalBalance2), balance2.sub(balance1));
      assert.equal((await vault.shares(TEST_USER)).toString(), "0");
    });
  });

  describe("#withdrawInstantly", () => {
    time.revertToSnapshotAfterEach();

    beforeEach(async function () {
      await vaultProxy.upgradeTo(newImplementation);
    });

    it("Withdraws stETH after depositing ETH", async () => {
      const depositAmount = parseEther("10");
      const withdrawAmount = depositAmount.div(2);
      await vault.connect(ownerSigner).depositETH({ value: depositAmount });

      const balance0 = await steth.balanceOf(ownerSigner.address);
      const totalBalance0 = await vault.totalBalance();
      await vault.connect(ownerSigner).withdrawInstantly(withdrawAmount, 0);

      const balance1 = await steth.balanceOf(ownerSigner.address);
      const totalBalance1 = await vault.totalBalance();
      assert.bnGte(balance1.sub(balance0).add(3), withdrawAmount);
      assert.bnGte(
        totalBalance0.sub(totalBalance1).add(3),
        balance1.sub(balance0)
      );

      await vault.connect(ownerSigner).withdrawInstantly(withdrawAmount, 0);

      const balance2 = await steth.balanceOf(ownerSigner.address);
      const totalBalance2 = await vault.totalBalance();
      assert.bnGte(balance2.sub(balance1).add(3), withdrawAmount);
      assert.bnGte(
        totalBalance1.sub(totalBalance2).add(3),
        balance2.sub(balance1)
      );
    });

    it("Withdraws stETH after depositing stETH", async () => {
      const depositAmount = parseEther("10");
      let stethBalance = await steth.balanceOf(ownerSigner.address);
      await steth.connect(ownerSigner).submit(ownerSigner.address, {
        value: depositAmount,
      });
      stethBalance = (await steth.balanceOf(ownerSigner.address)).sub(
        stethBalance
      );
      const withdrawAmount = stethBalance.div(2);
      await steth.connect(ownerSigner).approve(vault.address, stethBalance);

      await vault.connect(ownerSigner).depositYieldToken(stethBalance);

      const balance0 = await steth.balanceOf(ownerSigner.address);
      const totalBalance0 = await vault.totalBalance();
      await vault.connect(ownerSigner).withdrawInstantly(withdrawAmount, 0);

      const balance1 = await steth.balanceOf(ownerSigner.address);
      const totalBalance1 = await vault.totalBalance();
      assert.bnGte(balance1.sub(balance0).add(3), withdrawAmount);
      assert.bnGte(
        totalBalance0.sub(totalBalance1).add(3),
        balance1.sub(balance0)
      );

      await vault.connect(ownerSigner).withdrawInstantly(withdrawAmount, 0);

      const balance2 = await steth.balanceOf(ownerSigner.address);
      const totalBalance2 = await vault.totalBalance();
      assert.bnGte(balance2.sub(balance1).add(3), withdrawAmount);
      assert.bnGte(
        totalBalance1.sub(totalBalance2).add(3),
        balance2.sub(balance1)
      );
    });
  });

  const getVaultStorage = async (storageIndex: BigNumberish) => {
    return await ethers.provider.getStorageAt(
      deployments.mainnet.RibbonThetaVaultSTETHCall,
      storageIndex
    );
  };

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

  const getCurrentOptionExpiry = async () => {
    const currentOption = await vault.currentOption();
    const otoken = await ethers.getContractAt("IOtoken", currentOption);
    return otoken.expiryTimestamp();
  };

  const getCurrentOptionStrike = async () => {
    const currentOption = await vault.currentOption();
    const otoken = await ethers.getContractAt("IOtoken", currentOption);
    return otoken.strikePrice();
  };
});
