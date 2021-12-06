import { TaskArguments } from "hardhat/types";
import {
  DEX_FACTORY,
  DEX_ROUTER,
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  LDO_ADDRESS,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  STETH_ETH_CRV_POOL,
  USDC_ADDRESS,
  WETH_ADDRESS,
  WSTETH_ADDRESS,
} from "../../constants/constants";

const main = async (
  _taskArgs: TaskArguments,
  { deployments, network, run }
) => {
  const chainId = network.config.chainId;
  const RibbonThetaVaultLogic = await deployments.get("RibbonThetaVaultLogic");
  const RibbonThetaVaultSTETHLogic = await deployments.get(
    "RibbonThetaVaultSTETHLogic"
  );
  const VaultLifecycle = await deployments.get("VaultLifecycle");
  const VaultLifecycleSTETH = await deployments.get("VaultLifecycleSTETH");

  try {
    await run("verify:verify", {
      address: VaultLifecycle.address,
    });
  } catch (e) {
    console.error(e);
  }

  try {
    await run("verify:verify", {
      address: VaultLifecycleSTETH.address,
    });
  } catch (e) {
    console.error(e);
  }

  const THETA_VAULT_ARGS = [
    WETH_ADDRESS[chainId],
    USDC_ADDRESS[chainId],
    OTOKEN_FACTORY[chainId],
    GAMMA_CONTROLLER[chainId],
    MARGIN_POOL[chainId],
    GNOSIS_EASY_AUCTION[chainId],
    DEX_ROUTER[chainId],
    DEX_FACTORY[chainId],
  ];

  try {
    await run("verify:verify", {
      address: RibbonThetaVaultLogic.address,
      constructorArguments: THETA_VAULT_ARGS,
      libraries: { VaultLifecycle: VaultLifecycle.address },
    });
  } catch (e) {
    console.error(e);
  }

  const THETA_VAULT_STETH_ARGS = [
    WETH_ADDRESS[chainId],
    USDC_ADDRESS[chainId],
    WSTETH_ADDRESS,
    LDO_ADDRESS,
    OTOKEN_FACTORY[chainId],
    GAMMA_CONTROLLER[chainId],
    MARGIN_POOL[chainId],
    GNOSIS_EASY_AUCTION[chainId],
    STETH_ETH_CRV_POOL,
  ];

  try {
    await run("verify:verify", {
      address: RibbonThetaVaultSTETHLogic.address,
      constructorArguments: THETA_VAULT_STETH_ARGS,
      libraries: {
        VaultLifecycle: VaultLifecycle.address,
        VaultLifecycleSTETH: VaultLifecycleSTETH.address,
      },
    });
  } catch (e) {
    console.error(e);
  }
};
export default main;
