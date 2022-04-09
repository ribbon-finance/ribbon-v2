import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID } from "../../constants/constants";

import ETH_RibbonThetaVaultETHCall from "../../deployments/mainnet/RibbonThetaVaultETHCall.json";
import ETH_RibbonThetaVaultSTETHCall from "../../deployments/mainnet/RibbonThetaVaultSTETHCall.json";

import AVAX_RibbonThetaVaultETHCall from "../../deployments/avax/RibbonThetaVaultETHCall.json";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } =
    await getNamedAccounts();
  console.log(`19 - Vault Queue`);

  const chainId = network.config.chainId;

  // eth or avax vault
  const ethVaultAddr = CHAINID.ETH_MAINNET === chainId
    ? ETH_RibbonThetaVaultETHCall.address
    : AVAX_RibbonThetaVaultETHCall.address;

  // staked eth vault only, on avax set to deployer address to if issues with lost funds
  const stethVaultAddr = CHAINID.ETH_MAINNET === chainId
    ? ETH_RibbonThetaVaultSTETHCall.address
    : deployer;

  const vaultQueue = await deploy("vaultQueue", {
    contract: "VaultQueue",
    from: deployer,
    args: [ethVaultAddr, stethVaultAddr],
  });

  console.log(`vaultQueue @ ${vaultQueue.address}`);

  // console.log('Calling vaultQueue initialize()....');

  // await vaultQueue.initialize();

  console.log('Verify vaultQueue....');
  try {
    await run("verify:verify", {
      address: vaultQueue.address,
      constructorArguments: [ethVaultAddr, stethVaultAddr],
    });
  } catch (error) {
    console.log(error);
  }
};

main.tags = ["VaultQueue"];
export default main;
