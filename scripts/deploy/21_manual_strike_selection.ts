import { run } from "hardhat";
import { DeployResult } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID } from "../../constants/constants";

const ASSETS = {
  [CHAINID.ETH_MAINNET]: [
    "AAVE Call",
    "ETH Call",
    "ETH Put",
    "WBTC Call",
    "APE Call",
  ],
  [CHAINID.AVAX_MAINNET]: ["AVAX Call", "AVAX Put"],
};

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`20 - Deploying Manual Strike Selection on ${network.name}`);

  const chainId = network.config.chainId;

  try {
    await run("verify:verify", {
      address: "0x3C8114263092FD27AcFeAA99549D4F3066D7036c",
      constructorArguments: [],
    });
    await run("verify:verify", {
      address: "0xaB40513B6f0A33a68B59CCf90cB6f892b4bE1573",
      constructorArguments: [],
    });
  } catch (error) {
    console.log(error);
  }

  for (let vault of ASSETS[chainId]) {
    const [asset, optionType] = vault.split(" ");

    let manualStrikeSelection: DeployResult;

    manualStrikeSelection = await deploy(
      "ManualStrikeSelection" + asset + optionType,
      {
        contract: "ManualStrikeSelection",
        from: deployer,
        args: [],
      }
    );

    console.log(
      `manualStrikeSelection${asset + optionType} @ ${
        manualStrikeSelection.address
      }`
    );

    try {
      await run("verify:verify", {
        address: manualStrikeSelection.address,
        constructorArguments: [],
      });
    } catch (error) {
      console.log(error);
    }
  }
};
main.tags = ["ManualStrikeSelection"];

export default main;
