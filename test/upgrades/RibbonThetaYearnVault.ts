import { assert } from "chai";
import { ethers, network } from "hardhat";
import {
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
  YEARN_REGISTRY_ADDRESS,
} from "../../constants/constants";
import { objectEquals, parseLog, serializeMap } from "../helpers/utils";
import deployments from "../../constants/deployments.json";
import { BigNumberish, Contract } from "ethers";
import * as time from "../helpers/time";

const { parseEther } = ethers.utils;

const UPGRADE_ADMIN = "0x223d59FA315D7693dF4238d1a5748c964E615923";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// UPDATE THESE VALUES BEFORE WE ATTEMPT AN UPGRADE
const FORK_BLOCK = 14665589;

const CHAINID = process.env.CHAINID ? Number(process.env.CHAINID) : 1;

describe("RibbonThetaYearnVault upgrade", () => {
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

    const deploymentNames = ["RibbonThetaVaultETHPutYearn"];
    deploymentNames.forEach((name) => vaults.push(deployments.mainnet[name]));
  });

  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultETHPutYearn);
});

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
    "collateralToken",
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
      vault = await ethers.getContractAt("RibbonThetaYearnVault", vaultAddress);

      variables = await getVariablesFromContract(vault);

      const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
      const vaultLifecycleLib = await VaultLifecycle.deploy();

      const VaultLifecycleYearn = await ethers.getContractFactory(
        "VaultLifecycleYearn"
      );
      const VaultLifecycleYearnLib = await VaultLifecycleYearn.deploy();

      const RibbonThetaYearnVault = await ethers.getContractFactory(
        "RibbonThetaYearnVault",
        {
          libraries: {
            VaultLifecycle: vaultLifecycleLib.address,
            VaultLifecycleYearn: VaultLifecycleYearnLib.address,
          },
        }
      );
      const newImplementationContract = await RibbonThetaYearnVault.deploy(
        WETH_ADDRESS[CHAINID],
        USDC_ADDRESS[CHAINID],
        OTOKEN_FACTORY[CHAINID],
        GAMMA_CONTROLLER[CHAINID],
        MARGIN_POOL[CHAINID],
        GNOSIS_EASY_AUCTION[CHAINID],
        YEARN_REGISTRY_ADDRESS
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
