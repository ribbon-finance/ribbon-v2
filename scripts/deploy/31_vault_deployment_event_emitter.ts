import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log("31 - Deploying VaultDeploymentEventEmitter on", network.name);

  const vaultDeploymentEventEmitter = await deploy("VaultDeploymentEventEmitter", {
    contract: "VaultDeploymentEventEmitter",
    from: deployer,
  });

  console.log(`VaultDeploymentEventEmitter @ ${vaultDeploymentEventEmitter.address}`);

  try {
    await run("verify:verify", {
      address: vaultDeploymentEventEmitter.address,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["VaultDeploymentEventEmitter"];

export default main;
