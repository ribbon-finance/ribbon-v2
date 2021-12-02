import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WETH_ADDRESS,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  GNOSIS_EASY_AUCTION,
  DEX_ROUTER,
  DEX_FACTORY,
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

  // Supports Uniswap V3 only
  const dexRouter = await deploy("UniswapRouter", {
    contract: "UniswapRouter",
    from: deployer,
  });

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
      DEX_ROUTER[chainId],
      DEX_FACTORY[chainId]
    ],
    libraries: {
      VaultLifecycle: lifecycle.address,
      UniswapRouter: dexRouter.address, // Supports only Uniswap v3
    },
  });
  console.log(`RibbonThetaVaultLogic @ ${vault.address}`);
};
main.tags = ["RibbonThetaVaultLogic"];

export default main;
