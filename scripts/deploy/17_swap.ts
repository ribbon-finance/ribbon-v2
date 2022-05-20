import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`17 - Deploying Swap Contract on ${network.name}`);

  const swap = await deploy("Swap", {
    contract: "Swap",
    from: deployer,
  });

  console.log(`Swap @ ${swap.address}`);

  try {
    await run("verify:verify", {
      address: swap.address
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["Swap"];

export default main;
