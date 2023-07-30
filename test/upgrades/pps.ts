import { ethers, network } from "hardhat";
import {
  CHAINID,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/constants";
import { Contract } from "ethers/lib/ethers";
import { assert } from "../helpers/assertions";

const { parseEther } = ethers.utils;

const UPGRADE_ADMIN = "0x31351f2BD9e94813BCf0cA04B5E6e2b7ceAFC7c6";
const VAULT_ADDRESS = "0x6BF686d99A4cE17798C45d09C21181fAc29A9fb3";

// UPDATE THESE VALUES BEFORE WE ATTEMPT AN UPGRADE
const FORK_BLOCK = 20754457;

describe("RibbonThetaVault upgrade", () => {
  let vault: Contract;

  before(async function () {
    // We need to checkpoint the contract on mainnet to a past block before the upgrade happens
    // This means the `implementation` is pointing to an old contract
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.AVAX_URI,
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

    const adminSigner = await ethers.provider.getSigner(UPGRADE_ADMIN);

    const VaultLifecycle = await ethers.getContractFactory(
      "VaultLifecycleWithSwap"
    );
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
      WETH_ADDRESS[CHAINID.AVAX_MAINNET],
      USDC_ADDRESS[CHAINID.AVAX_MAINNET],
      OTOKEN_FACTORY[CHAINID.AVAX_MAINNET],
      GAMMA_CONTROLLER[CHAINID.AVAX_MAINNET],
      MARGIN_POOL[CHAINID.AVAX_MAINNET],
      SwapContract.address
    );
    const newImplementation = newImplementationContract.address;

    const proxy = await ethers.getContractAt(
      "AdminUpgradeabilityProxy",
      VAULT_ADDRESS
    );

    await proxy.connect(adminSigner).upgradeTo(newImplementation);

    vault = await ethers.getContractAt(
      "RibbonThetaVaultWithSwap",
      VAULT_ADDRESS
    );
  });

  it("has correct price per share", async () => {
    assert.bnEqual(
      await vault.pricePerShare(),
      parseEther("1.030715372104514369")
    );
  });
});
