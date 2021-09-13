import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ManualVolOracle_BYTECODE } from "../../constants/constants";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  console.log("00 - Deploying ManualVolOracle on", network.name);

  const { deployer, keeper } = await getNamedAccounts();

  await deploy("ManualVolOracle", {
    from: deployer,
    contract: {
      abi: ManualVolOracle_ABI,
      bytecode: ManualVolOracle_BYTECODE,
    },
    args: [keeper],
  });
};
main.tags = ["ManualVolOracle"];

export default main;
