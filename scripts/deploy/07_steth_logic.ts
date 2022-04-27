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
  LDO_ADDRESS,
  STETH_ETH_CRV_POOL,
  WSTETH_ADDRESS,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  if (chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI) {
    console.log(
      `07 - Skipping deployment of Theta Vault stETH logic on ${network.name} because no stEth on Avax`
    );
    return;
  }

  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`07 - Deploying Theta Vault stETH logic on ${network.name}`);

  const lifecycle = await deployments.get("VaultLifecycle");

  const lifecycleSTETH = await deploy("VaultLifecycleSTETH", {
    contract: "VaultLifecycleSTETH",
    from: deployer,
  });
  console.log(`VaultLifeCycleSTETH @ ${lifecycleSTETH.address}`);

  const args = [
    WETH_ADDRESS[chainId],
    USDC_ADDRESS[chainId],
    WSTETH_ADDRESS[chainId],
    LDO_ADDRESS,
    OTOKEN_FACTORY[chainId],
    GAMMA_CONTROLLER[chainId],
    MARGIN_POOL[chainId],
    GNOSIS_EASY_AUCTION[chainId],
    STETH_ETH_CRV_POOL,
  ];

  const vault = await deploy("RibbonThetaVaultSTETHLogic", {
    contract: "RibbonThetaSTETHVault",
    from: deployer,
    args,
    libraries: {
      VaultLifecycle: lifecycle.address,
      VaultLifecycleSTETH: lifecycleSTETH.address,
    },
  });

  console.log(`RibbonThetaVaultSTETHLogic @ ${vault.address}`);

  try {
    await run("verify:verify", {
      address: lifecycleSTETH.address,
      constructorArguments: [],
    });
  } catch (error) {
    console.log(error);
  }

  try {
    await run("verify:verify", {
      address: vault.address,
      constructorArguments: args,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultSTETHLogic"];

export default main;
