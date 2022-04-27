import { run } from "hardhat";
import { DeployResult } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
} from "../../constants/constants";
import {
  STRIKE_STEP,
  STRIKE_DELTA,
  PERP_STRIKE_MULTIPLIER,
} from "../utils/constants";

const ASSETS = {
  [CHAINID.ETH_MAINNET]: [
    "AAVE Call",
    "ETH Call",
    "ETH Put",
    "WBTC Call",
    "APE Call",
    "PERP Call"
  ],
  [CHAINID.AVAX_MAINNET]: [
    "AVAX Call",
    "AVAX Put"
  ]
};

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } =
    await getNamedAccounts();
  console.log(`00 - Deploying Strike Selection on ${network.name}`);

  const chainId = network.config.chainId;

  for (let vault of ASSETS[chainId]) {
    const [asset, optionType] = vault.split(" ");
    const pricer = await deployments.get("OptionsPremiumPricer" + asset + optionType);

    let strikeSelection: DeployResult;
    if (asset === "PERP") {
      strikeSelection = await deploy("StrikeSelection" + asset + optionType, {
        contract: "PercentStrikeSelection",
        from: deployer,
        args: [pricer.address, PERP_STRIKE_MULTIPLIER, STRIKE_STEP[asset]],
      });
    } else {
      strikeSelection = await deploy("StrikeSelection" + asset + optionType, {
        contract: "DeltaStrikeSelection",
        from: deployer,
        args: [pricer.address, STRIKE_DELTA, STRIKE_STEP[asset]],
      });
    }


    console.log(
      `strikeSelection${asset + optionType} @ ${strikeSelection.address}`
    );

    try {
      await run("verify:verify", {
        address: strikeSelection.address,
        constructorArguments: [
          pricer.address,
          STRIKE_DELTA,
          STRIKE_STEP[asset],
        ],
      });
    } catch (error) {
      console.log(error);
    }
  }
};
main.tags = ["StrikeSelection"];

export default main;
