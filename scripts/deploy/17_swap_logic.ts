import { ethers, run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer, owner, admin } = await getNamedAccounts();
  console.log(`17 - Deploying Swap Logic on ${network.name}`);

  const swapLogic = await deploy("SwapLogic", {
    contract: "Swap",
    from: deployer,
  });

  console.log(`Swap Logic @ ${swapLogic.address}`);

  try {
    await run("verify:verify", {
      address: swapLogic.address,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["SwapLogic"];

export default main;
