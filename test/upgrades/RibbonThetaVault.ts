import { assert } from "chai";
import { ethers, network } from "hardhat";
import {
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
  DEX_ROUTER,
  DEX_FACTORY,
} from "../../constants/constants";
import { parseLog } from "../helpers/utils";
import deployments from "../../constants/deployments.json";
import { BigNumber, BigNumberish } from "ethers";

const { parseEther } = ethers.utils;

const UPGRADE_ADMIN = "0x223d59FA315D7693dF4238d1a5748c964E615923";
const ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// UPDATE THESE VALUES BEFORE WE ATTEMPT AN UPGRADE
const FORK_BLOCK = 13731470;

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
    ];
    deploymentNames.forEach((name) =>
      vaults.push(deployments.mainnet[name])
    );
  });

  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultETHCall);
  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultWBTCCall);
  checkIfStorageNotCorrupted(deployments.mainnet.RibbonThetaVaultAAVECall);
});

function checkIfStorageNotCorrupted(vaultAddress: string) {
  const getVaultStorage = async (storageIndex: BigNumberish) => {
    return await ethers.provider.getStorageAt(vaultAddress, storageIndex);
  };

  const storageSlots = [
    ADMIN_SLOT,
    0,
    1,
    101,
    153,
    154,
    155,
    204,
    205,
    206,
    207,
    208,
    209,
    210,
    211,
    212,
    213,
    214,
    245,
    246,
    247,
    248,
    249,
    250,
    251,
    252,
    253,
    254,
    255,
    256,
  ].map((s) => BigNumber.from(s));

  let storageLayout: [BigNumber, string][];

  describe(`Vault ${vaultAddress}`, () => {
    let newImplementation: string;

    before(async () => {
      const storageValues = await Promise.all(
        storageSlots.map((slotIndex) => getVaultStorage(slotIndex))
      );
      storageLayout = storageSlots.map((slotIndex, arrIndex) => [
        slotIndex,
        storageValues[arrIndex],
      ]);

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
        GNOSIS_EASY_AUCTION[CHAINID],
        DEX_ROUTER[CHAINID],
        DEX_FACTORY[CHAINID]
      );
      newImplementation = newImplementationContract.address;
    });

    it("has the correct storage state after an upgrade", async () => {
      const vaultProxy = await ethers.getContractAt(
        "AdminUpgradeabilityProxy",
        vaultAddress
      );
      const adminSigner = await ethers.provider.getSigner(UPGRADE_ADMIN);

      const res = await vaultProxy
        .connect(adminSigner)
        .upgradeTo(newImplementation);

      const receipt = await res.wait();

      const log = await parseLog("AdminUpgradeabilityProxy", receipt.logs[0]);
      assert.equal(log.args.implementation, newImplementation);
      assert.equal(
        await getVaultStorage(IMPLEMENTATION_SLOT),
        "0x000000000000000000000000" + newImplementation.slice(2).toLowerCase()
      );

      // Now we verify that the storage values are not corrupted after an upgrade
      for (let i = 0; i < storageLayout.length; i++) {
        const [index, value] = storageLayout[i];
        assert.equal(
          await getVaultStorage(index),
          value,
          `Mismatched value at index ${index}`
        );
      }
    });
  });
}
