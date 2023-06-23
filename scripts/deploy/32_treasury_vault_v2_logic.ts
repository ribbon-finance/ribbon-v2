import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  if (chainId !== CHAINID.ARB_MAINNET) {
    console.log(
      `32 - Skipping deployment of Treasury Vault V2 logic on ${network.name}`
    );
    return;
  }

  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`32 - Deploying Treasury Vault V2 logic on ${network.name}`);

  const lifecycleTreasury = await deploy("VaultLifecycleTreasury", {
    contract: "VaultLifecycleTreasury",
    from: deployer,
  });
  console.log(`VaultLifeCycleTreasury @ ${lifecycleTreasury.address}`);

  const vault = await deploy("RibbonTreasuryVaultV2Logic", {
    contract: "RibbonTreasuryVaultV2",
    from: deployer,
    args: [
      USDC_ADDRESS[chainId],
      OTOKEN_FACTORY[chainId],
      GAMMA_CONTROLLER[chainId],
      MARGIN_POOL[chainId],
    ],
    libraries: {
      VaultLifecycleTreasury: lifecycleTreasury.address,
    },
  });

  console.log(`RibbonTreasuryVaultV2Logic @ ${vault.address}`);

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
        USDC_ADDRESS[chainId],
        OTOKEN_FACTORY[chainId],
        GAMMA_CONTROLLER[chainId],
        MARGIN_POOL[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultV2Logic"];

export default main;
