import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID, STETH_ADDRESS, STETH_ETH_CRV_POOL } from "../../constants/constants";
import RibbonThetaVaultSTETHCall_Mainnet from "../../deployments/mainnet/RibbonThetaVaultSTETHCall.json";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deployer } = await getNamedAccounts();
  console.log(`25 - Deploying stETH Deposit Helper on ${network.name}`);

  const chainId = network.config.chainId;

  // Only supports eth mainnet
  if (
    chainId === CHAINID.AVAX_MAINNET ||
    chainId === CHAINID.AVAX_FUJI ||
    chainId === CHAINID.ETH_KOVAN
  ) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const vault = RibbonThetaVaultSTETHCall_Mainnet;

  const constructorArguments = [
    STETH_ETH_CRV_POOL,
    vault.address,
    STETH_ADDRESS
  ];
  const stETHDepositHelper = await deployments.deploy("STETHDepositHelper", {
    contract: "STETHDepositHelper",
    from: deployer,
    args: constructorArguments,
  });

  console.log(`stETHDepositHelper @ ${stETHDepositHelper.address}`);

  try {
    await run("verify:verify", {
      address: stETHDepositHelper.address,
      constructorArguments,
    });
  } catch (error) {
    console.log(error);
  }
};

main.tags = ["STETHDepositHelper"];

export default main;
