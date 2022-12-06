import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  GNOSIS_EASY_AUCTION,
  WETH_ADDRESS,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  if (
    chainId === CHAINID.AVAX_MAINNET ||
    chainId === CHAINID.AVAX_FUJI
  ) {
    console.log(
      `12 - Skipping deployment of Treasury Vault logic on ${network.name}`
    );
    return;
  }

  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`12 - Deploying Treasury Vault logic on ${network.name}`);

  const lifecycleTreasury = await deploy("VaultLifecycleTreasuryBare", {
    contract: "VaultLifecycleTreasuryBare",
    from: deployer,
  });
  console.log(`VaultLifeCycleTreasury @ ${lifecycleTreasury.address}`);

  const vault = await deploy("RibbonTreasuryVaultLogic", {
    contract: "RibbonTreasuryVault",
    from: deployer,
    args: [
      WETH_ADDRESS[chainId],
      USDC_ADDRESS[chainId],
      "0x4114b7C04bBbA682130cae2bA26FC5d2473B4Ddc",
      "0x4bec71A4Ac41eE9761440F6921DD17bA1C1213B1",
      "0x3c212A044760DE5a529B3Ba59363ddeCcc2210bE",
      "0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101",
    ],
    libraries: {
      VaultLifeCycleTreasuryBare: lifecycleTreasury.address,
    },
  });

  console.log(`RibbonTreasuryVaultLogic @ ${vault.address}`);

  try {
    await run("verify:verify", {
      address: lifecycleTreasury.address,
      constructorArguments: [],
    });
  } catch (error) {
    console.log(error);
  }

  try {
    await run("verify:verify", {
      address: vault.address,
      constructorArguments: [
        WETH_ADDRESS[chainId],
        USDC_ADDRESS[chainId],
        "0x4114b7C04bBbA682130cae2bA26FC5d2473B4Ddc",
        "0x4bec71A4Ac41eE9761440F6921DD17bA1C1213B1",
        "0x3c212A044760DE5a529B3Ba59363ddeCcc2210bE",
        "0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101",
      ],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultLogic"];

export default main;
