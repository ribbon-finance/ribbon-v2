import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  USDC_ADDRESS,
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
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`04 - Deploying Delta Vault logic on ${network.name}`);

  const chainId = network.config.chainId;
  const lifecycle = await deployments.get("VaultLifecycle");

  await deploy("RibbonDeltaVaultLogic", {
    contract: "RibbonDeltaVault",
    from: deployer,
    args: [
      WETH_ADDRESS[chainId],
      USDC_ADDRESS[chainId],
      GAMMA_CONTROLLER[chainId],
      MARGIN_POOL[chainId],
      GNOSIS_EASY_AUCTION[chainId]
    ],
    libraries: {
      VaultLifecycle: lifecycle.address,
    },
  });
};
main.tags = ["RibbonDeltaVaultLogic"];

export default main;
