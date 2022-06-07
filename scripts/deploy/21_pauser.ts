import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  NETWORK_NAMES,
  STETH_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer, keeper } = await getNamedAccounts();
  console.log(`21 - Deploying Pauser on ${network.name}`);

  const chainId = network.config.chainId;
  const networkName = NETWORK_NAMES[chainId];
  const stethVault = "0x53773E034d9784153471813dacAFF53dBBB78E8c";

  const constructorArguments = [
    keeper,
    WETH_ADDRESS[chainId],
    STETH_ADDRESS,
    stethVault,
  ];

  const pauser = await deploy(`RibbonVaultPauser${networkName}`, {
    from: deployer,
    contract: "RibbonVaultPauser",
    args: constructorArguments,
  });
  // const pauser = await deployments.get(`RibbonVaultPauser${networkName}`);

  console.log(`RibbonVaultPauser${networkName} @ ${pauser.address}`);

  try {
    await run("verify:verify", {
      address: pauser.address,
      constructorArguments,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonVaultPauser"];

export default main;
