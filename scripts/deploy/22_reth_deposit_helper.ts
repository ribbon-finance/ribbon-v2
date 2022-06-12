import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  RETH_ADDRESS,
  RETH_DEPOSIT_POOL_ADDRESS,
} from "../../constants/constants";
import RibbonThetaVaultRETHCall_KOVAN from "../../deployments/kovan/RibbonThetaVaultRETHCall.json";
import RibbonThetaVaultRETHCall_MAINNET from "../../deployments/mainnet/RibbonThetaVaultRETHCall.json";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deployer } = await getNamedAccounts();
  console.log(`22 - Deploying rETH Deposit Helper on ${network.name}`);

  const chainId = network.config.chainId;

  if (chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI) {
    console.log(
      `22 - Skipping deployment rETH Call Theta Vault Deposit Helper on ${network.name} because no rETH on Avax`
    );
    return;
  }

  const vault =
    chainId === CHAINID.ETH_MAINNET
      ? RibbonThetaVaultRETHCall_MAINNET
      : RibbonThetaVaultRETHCall_KOVAN;

  const rETHDepositHelper = await deployments.deploy("RETHDepositHelper", {
    contract: "RETHDepositHelper",
    from: deployer,
    args: [
      RETH_ADDRESS[chainId],
      RETH_DEPOSIT_POOL_ADDRESS[chainId],
      vault.address,
    ],
  });

  console.log(`rETHDepositHelper @ ${rETHDepositHelper.address}`);

  try {
    await run("verify:verify", {
      address: rETHDepositHelper.address,
      constructorArguments: [
        RETH_ADDRESS[chainId],
        RETH_DEPOSIT_POOL_ADDRESS[chainId],
        vault.address,
      ],
    });
  } catch (error) {
    console.log(error);
  }
};

main.tags = ["RETHDepositHelper"];

export default main;
