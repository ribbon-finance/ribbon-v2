import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  GNOSIS_EASY_AUCTION,
  WETH_ADDRESS,
  TD_OTOKEN_FACTORY,
  TD_CONTROLLER,
  TD_MARGIN_POOL,
} from "../../constants/constants";

interface args {
  protocol: "10D" | "Gamma"; // Will deploy using 10D or Gamma OToken factory, controller and margin pool respectively
}

// Edit this based on the args you want to use
const argsToUse: args = { protocol: null };

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  if (chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI) {
    console.log(
      `00 - Skipping deployment of Treasury Vault logic on ${network.name}`
    );
    return;
  }

  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`00 - Deploying Treasury Vault logic on ${network.name}`);

  const lifecycleTreasury = await deploy("VaultLifecycleTreasury", {
    contract: "VaultLifecycleTreasury",
    from: deployer,
  });
  console.log(`VaultLifeCycleTreasury @ ${lifecycleTreasury.address}`);

  const vault = await deploy("RibbonTreasuryVaultLogic", {
    contract: "RibbonTreasuryVault",
    from: deployer,
    args: [
      WETH_ADDRESS[chainId],
      USDC_ADDRESS[chainId],
      argsToUse.protocol == "Gamma"
        ? OTOKEN_FACTORY[chainId]
        : TD_OTOKEN_FACTORY[chainId],
      argsToUse.protocol == "Gamma"
        ? GAMMA_CONTROLLER[chainId]
        : TD_CONTROLLER[chainId],
      argsToUse.protocol == "Gamma"
        ? MARGIN_POOL[chainId]
        : TD_MARGIN_POOL[chainId],
      GNOSIS_EASY_AUCTION[chainId],
    ],
    libraries: {
      VaultLifecycleTreasury: lifecycleTreasury.address,
    },
  });

  console.log(`RibbonTreasuryVaultLogic @ ${vault.address}`);

  try {
    await run("verify:verify", {
      address: lifecycleTreasury.address,
      constructorArguments: [],
    });
  } catch (error) {
    console.log(error);
  }

  try {
    await run("verify:verify", {
      address: vault.address,
      constructorArguments: [
        WETH_ADDRESS[chainId],
        USDC_ADDRESS[chainId],
        argsToUse.protocol == "Gamma"
          ? OTOKEN_FACTORY[chainId]
          : TD_OTOKEN_FACTORY[chainId],
        argsToUse.protocol == "Gamma"
          ? GAMMA_CONTROLLER[chainId]
          : TD_CONTROLLER[chainId],
        argsToUse.protocol == "Gamma"
          ? MARGIN_POOL[chainId]
          : TD_MARGIN_POOL[chainId],
        GNOSIS_EASY_AUCTION[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }
};
// Deploy with npx hardhat deploy --tags ManualRibbonTreasuryVaultLogic --network mainnet after editing args you want to use
main.tags = ["ManualRibbonTreasuryVaultLogic"];

export default main;
