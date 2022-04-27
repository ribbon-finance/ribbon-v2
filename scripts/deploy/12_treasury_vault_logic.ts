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

  const lifecycleTreasury = await deploy("VaultLifecycleTreasury", {
    contract: "VaultLifecycleTreasury",
    from: deployer,
  });
  console.log(`VaultLifeCycleTreasury @ ${lifecycleTreasury.address}`);

  const vault = await deploy("RibbonTreasuryVaultLogic", {
    contract: "RibbonTreasuryVault",
    from: deployer,
    args: [
      WETH_ADDRESS[chainId],
      USDC_ADDRESS[chainId],
      OTOKEN_FACTORY[chainId],
      GAMMA_CONTROLLER[chainId],
      MARGIN_POOL[chainId],
      GNOSIS_EASY_AUCTION[chainId],
    ],
    libraries: {
      VaultLifecycleTreasury: lifecycleTreasury.address,
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
        OTOKEN_FACTORY[chainId],
        GAMMA_CONTROLLER[chainId],
        MARGIN_POOL[chainId],
        GNOSIS_EASY_AUCTION[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultLogic"];

export default main;
