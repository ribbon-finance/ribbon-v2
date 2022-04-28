import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID, SAVAX_ADDRESS } from "../../constants/constants";
import RibbonThetaVaultSAVAXCall_Avax from "../../deployments/avax/RibbonThetaVaultSAVAXCall.json";
import RibbonThetaVaultSAVAXCall_Fuji from "../../deployments/fuji/RibbonThetaVaultSAVAXCall.json";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deployer } = await getNamedAccounts();
  console.log(`15 - Deploying sAVAX Deposit Helper on ${network.name}`);

  const chainId = network.config.chainId;

  if (!(chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI)) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const vault =
    chainId === CHAINID.AVAX_MAINNET
      ? RibbonThetaVaultSAVAXCall_Avax
      : RibbonThetaVaultSAVAXCall_Fuji;

  const sAVAXDepositHelper = await deployments.deploy("SAVAXDepositHelper", {
    contract: "SAVAXDepositHelper",
    from: deployer,
    args: [SAVAX_ADDRESS[chainId], vault.address],
  });

  console.log(`sAVAXDepositHelper @ ${sAVAXDepositHelper.address}`);

  try {
    await run("verify:verify", {
      address: sAVAXDepositHelper.address,
      constructorArguments: [SAVAX_ADDRESS[chainId], vault.address],
    });
  } catch (error) {
    console.log(error);
  }
};

main.tags = ["SAVAXDepositHelper"];

export default main;
