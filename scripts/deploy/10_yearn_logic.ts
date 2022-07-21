import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  WETH_ADDRESS,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`10 - Deploying Theta Vault Yearn logic on ${network.name}`);

  const chainId = network.config.chainId;

  const lifecycle = await deployments.get("VaultLifecycleWithSwap");

  const swapAddress = (await deployments.get("Swap")).address;

  const args = [
    WETH_ADDRESS[chainId],
    USDC_ADDRESS[chainId],
    OTOKEN_FACTORY[chainId],
    GAMMA_CONTROLLER[chainId],
    MARGIN_POOL[chainId],
    swapAddress
  ];

  const vault = await deploy("RibbonThetaVaultYearnLogic", {
    contract: "RibbonThetaYearnVault",
    from: deployer,
    args,
    libraries: {
      VaultLifecycleWithSwap: lifecycle.address
    },
  });
  console.log(`RibbonThetaYearnVaultLogic @ ${vault.address}`);

  try {
    await run("verify:verify", {
      address: vault.address,
      constructorArguments: args,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultYearnLogic"];

export default main;
