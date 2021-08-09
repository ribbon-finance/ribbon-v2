import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ManualVolOracle_BYTECODE } from "../../constants/constants";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  console.log("Deploying ManualVolOracle on", network.name);

  const { deployer, owner } = await getNamedAccounts();
  console.log("Deploying with", deployer);

  await deploy("ManualVolOracle", {
    from: deployer,
    contract: {
      abi: ManualVolOracle_ABI,
      bytecode: ManualVolOracle_BYTECODE,
    },
    args: [owner],
  });
};
main.tags = "ManualVolOracle";

export default main;
