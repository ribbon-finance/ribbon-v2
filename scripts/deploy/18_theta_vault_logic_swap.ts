import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WETH_ADDRESS,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  MARGIN_POOL,
  GAMMA_CONTROLLER,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`18 - Deploying Theta Vault with Swap logic on ${network.name}`);

  const chainId = network.config.chainId;

  const swap = await deployments.get("Swap");

  const lifecycle = await deploy("VaultLifecycleWithSwap", {
    contract: "VaultLifecycleWithSwap",
    from: deployer,
  });

  const vault = await deploy("RibbonThetaVaultWithSwapLogic", {
    contract: "RibbonThetaVaultWithSwap",
    from: deployer,
    args: [
      WETH_ADDRESS[chainId],
      USDC_ADDRESS[chainId],
      OTOKEN_FACTORY[chainId],
      GAMMA_CONTROLLER[chainId],
      MARGIN_POOL[chainId],
      swap.address,
    ],
    libraries: {
      VaultLifecycleWithSwap: lifecycle.address,
    },
  });
  console.log(`RibbonThetaVaultWithSwapLogic @ ${vault.address}`);

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
        swap.address,
      ],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultWithSwapLogic"];
main.dependencies = ["Swap"];

export default main;
