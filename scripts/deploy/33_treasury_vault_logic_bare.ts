import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  USDC_ADDRESS,
  GNOSIS_EASY_AUCTION,
  WETH_ADDRESS,
} from "../../constants/constants";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log(`12 - Deploying Treasury Vault Bare logic on ${network.name}`);

  const lifecycleTreasury = await deploy("VaultLifecycleTreasuryBare", {
    contract: "VaultLifecycleTreasuryBare",
    from: deployer,
  });
  console.log(`VaultLifeCycleTreasuryBare @ ${lifecycleTreasury.address}`);

  const vault = await deploy("RibbonTreasuryVaultLogicBare", {
    contract: "RibbonTreasuryVaultBare",
    from: deployer,
    args: [
      WETH_ADDRESS[chainId],
      USDC_ADDRESS[chainId],
      "0x4114b7c04bbba682130cae2ba26fc5d2473b4ddc", // OTOKEN_FACTORY
      "0x4bec71A4Ac41eE9761440F6921DD17bA1C1213B1", // GAMMA_CONTROLLER
      "0x3c212A044760DE5a529B3Ba59363ddeCcc2210bE", // MARGIN_POOL
      GNOSIS_EASY_AUCTION[chainId],
    ],
    libraries: {
      VaultLifecycleTreasuryBare: lifecycleTreasury.address,
    },
  });

  console.log(`RibbonTreasuryVaultLogicBare @ ${vault.address}`);

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
        "0x4114b7c04bbba682130cae2ba26fc5d2473b4ddc", // OTOKEN_FACTORY
        "0x4bec71A4Ac41eE9761440F6921DD17bA1C1213B1", // GAMMA_CONTROLLER
        "0x3c212A044760DE5a529B3Ba59363ddeCcc2210bE", // MARGIN_POOL
        GNOSIS_EASY_AUCTION[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultLogicBare"];

export default main;
