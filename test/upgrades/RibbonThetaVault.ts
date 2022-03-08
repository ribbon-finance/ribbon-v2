import { assert } from "chai";
import { ethers, network } from "hardhat";
import {
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
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
const NEW_IMPLEMENTATION = "0x2A0B88f5E1fba2909843A46877a9369d8aE8b5B5";
const FORK_BLOCK = 14343852;

const CHAINID = process.env.CHAINID ? Number(process.env.CHAINID) : 1;

describe("RibbonThetaVault upgrade", () => {
  let vaultAddressOfImplementationInRepo: string;

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
  });

  /**
   * We test 2 different addresses:
   * 1) A fixed address from a deployed contract on Ethereum mainnet (this is to validate upgrades)
   * 2) A dynamic address generated from the compiled contracts on the repo
   */

  // FIXED ADDRESS
  checkIfStorageNotCorrupted(
    deployments.mainnet.RibbonThetaVaultETHCall,
    NEW_IMPLEMENTATION
  );
  checkIfStorageNotCorrupted(
    deployments.mainnet.RibbonThetaVaultWBTCCall,
    NEW_IMPLEMENTATION
  );
  checkIfStorageNotCorrupted(
    deployments.mainnet.RibbonThetaVaultAAVECall,
    NEW_IMPLEMENTATION
  );

  // DYNAMIC ADDRESSES
  checkIfStorageNotCorrupted(
    deployments.mainnet.RibbonThetaVaultETHCall,
    vaultAddressOfImplementationInRepo
  );
  checkIfStorageNotCorrupted(
    deployments.mainnet.RibbonThetaVaultWBTCCall,
    vaultAddressOfImplementationInRepo
  );
  checkIfStorageNotCorrupted(
    deployments.mainnet.RibbonThetaVaultAAVECall,
    vaultAddressOfImplementationInRepo
  );
});

const deployNewVault = async () => {
  const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
  const vaultLifecycleLib = await VaultLifecycle.deploy();

  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
    libraries: {
      VaultLifecycle: vaultLifecycleLib.address,
    },
  });
  const newImplementationContract = await RibbonThetaVault.deploy(
    WETH_ADDRESS[CHAINID],
    USDC_ADDRESS[CHAINID],
    OTOKEN_FACTORY[CHAINID],
    GAMMA_CONTROLLER[CHAINID],
    MARGIN_POOL[CHAINID],
    GNOSIS_EASY_AUCTION[CHAINID]
  );
  return newImplementationContract.address;
};

function checkIfStorageNotCorrupted(
  vaultProxyAddress: string,
  newImplementation?: string
) {
  const getVaultStorage = async (storageIndex: BigNumberish) => {
    return await ethers.provider.getStorageAt(vaultProxyAddress, storageIndex);
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
  ];

  let variables: Record<string, unknown> = {};

  describe(`Vault ${vaultProxyAddress}${
    newImplementation ? `, newImplementation ${newImplementation}` : ""
  }`, () => {
    let vaultProxy: Contract;
    let vault: Contract;

    time.revertToSnapshotAfterEach();

    before(async () => {
      const adminSigner = await ethers.provider.getSigner(UPGRADE_ADMIN);

      vaultProxy = await ethers.getContractAt(
        "AdminUpgradeabilityProxy",
        vaultProxyAddress,
        adminSigner
      );
      vault = await ethers.getContractAt("RibbonThetaVault", vaultProxyAddress);

      variables = await getVariablesFromContract(vault);

      newImplementation = await deployNewVault();
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
