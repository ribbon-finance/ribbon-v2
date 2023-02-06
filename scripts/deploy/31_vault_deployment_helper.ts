import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log("31 - Deploying VaultDeploymentHelper on", network.name);

  const vaultDeploymentHelper = await deploy("VaultDeploymentHelper", {
    contract: "VaultDeploymentHelper",
    from: deployer,
  });

  console.log(`VaultDeploymentHelper @ ${vaultDeploymentHelper.address}`);

  try {
    await run("verify:verify", {
      address: vaultDeploymentHelper.address,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["VaultDeploymentHelper"];

export default main;
