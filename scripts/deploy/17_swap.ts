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

  const Swap = await ethers.getContractFactory("Swap");

  const initArgs = ["RIBBON SWAP", "1", owner];

  const initData = Swap.interface.encodeFunctionData("initialize", initArgs);

  const proxy = await deploy("Swap", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [swapLogic.address, admin, initData],
  });

  console.log(`Swap Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [swapLogic.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["Swap"];

export default main;
