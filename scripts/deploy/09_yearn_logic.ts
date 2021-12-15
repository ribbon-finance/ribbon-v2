import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  GNOSIS_EASY_AUCTION,
  WETH_ADDRESS,
  YEARN_REGISTRY_ADDRESS,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`09 - Deploying Theta Vault Yearn logic on ${network.name}`);

  const chainId = network.config.chainId;

  const lifecycle = await deployments.get("VaultLifecycle");

  const lifecycleYearn = await deploy("VaultLifecycleYearn", {
    contract: "VaultLifecycleYearn",
    from: deployer,
  });

  await deploy("RibbonThetaVaultYearnLogic", {
    contract: "RibbonThetaYearnVault",
    from: deployer,
    args: [
      WETH_ADDRESS[chainId],
      USDC_ADDRESS[chainId],
      OTOKEN_FACTORY[chainId],
      GAMMA_CONTROLLER[chainId],
      MARGIN_POOL[chainId],
      GNOSIS_EASY_AUCTION[chainId],
      YEARN_REGISTRY_ADDRESS,
    ],
    libraries: {
      VaultLifecycle: lifecycle.address,
      VaultLifecycleYearn: lifecycleYearn.address,
    },
  });
};
main.tags = ["RibbonThetaVaultYearnLogic"];

export default main;
