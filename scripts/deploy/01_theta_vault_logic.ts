import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WETH_ADDRESS,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  GNOSIS_EASY_AUCTION,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`01 - Deploying Theta Vault logic on ${network.name}`);

  const chainId = network.config.chainId;

  const lifecycle = await deploy("VaultLifecycle", {
    contract: "VaultLifecycle",
    from: deployer,
  });
  console.log(`VaultLifeCycle @ ${lifecycle.address}`);

  const vault = await deploy("RibbonThetaVaultLogic", {
    contract: "RibbonThetaVault",
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
      VaultLifecycle: lifecycle.address,
    },
  });
  console.log(`RibbonThetaVaultLogic @ ${vault.address}`);

  try {
    await run("verify:verify", {
      address: lifecycle.address,
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
main.tags = ["RibbonThetaVaultLogic"];

export default main;
