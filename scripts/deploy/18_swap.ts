import { ethers, run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer, owner, admin } = await getNamedAccounts();
  console.log(`18 - Deploying Swap Proxy on ${network.name}`);

  const swapAddress = (await deployments.get("SwapLogic")).address;
  const Swap = await ethers.getContractFactory("Swap");

  const initArgs = ["RIBBON SWAP", "1", owner];

  const initData = Swap.interface.encodeFunctionData("initialize", initArgs);

  const proxy = await deploy("Swap", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [swapAddress, admin, initData],
  });

  console.log(`Swap Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [swapAddress, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["Swap"];
main.dependencies = ["SwapLogic"];

export default main;
