import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  UNI_ADDRESS,
  UNI_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";
import {
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  STRIKE_DELTA,
  STRIKE_STEP,
} from "../utils/constants";
import { getDeltaStep } from "../../test/helpers/utils";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { BigNumber } = ethers;
  const { parseUnits } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();
  console.log(
    `29 - Deploying UNI Call Theta Vault With Swap on ${network.name}`
  );

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const chainId = network.config.chainId;
  const underlyingOracle = UNI_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const manualVolOracleContract = await ethers.getContractAt(
    ManualVolOracle_ABI,
    manualVolOracle.address
  );
  const optionId = await manualVolOracleContract.getOptionId(
    getDeltaStep("UNI"),
    UNI_ADDRESS[chainId],
    UNI_ADDRESS[chainId],
    false
  );

  const pricer = await deploy("OptionsPremiumPricerUNIWithSwap", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [optionId, manualVolOracle.address, underlyingOracle, stablesOracle],
  });

  console.log(`RibbonThetaVaultUNICall pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("StrikeSelectionUNIWithSwap", {
    contract: "DeltaStrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, STRIKE_STEP.UNI],
  });

  console.log(
    `RibbonThetaVaultUNICall strikeSelection @ ${strikeSelection.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [pricer.address, STRIKE_DELTA, STRIKE_STEP.UNI],
    });
  } catch (error) {
    console.log(error);
  }

  const logicDeployment = await deployments.get(
    "RibbonThetaVaultWithSwapLogic"
  );
  const lifecycle = await deployments.get("VaultLifecycleWithSwap");

  const RibbonThetaVault = await ethers.getContractFactory(
    "RibbonThetaVaultWithSwap",
    {
      libraries: {
        VaultLifecycleWithSwap: lifecycle.address,
      },
    }
  );

  const initArgs = [
    {
      _owner: owner,
      _keeper: keeper,
      _feeRecipient: feeRecipient,
      _managementFee: MANAGEMENT_FEE,
      _performanceFee: PERFORMANCE_FEE,
      _tokenName: "Ribbon UNI Theta Vault",
      _tokenSymbol: "rUNI-THETA",
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
    },
    {
      isPut: false,
      decimals: 18,
      asset: UNI_ADDRESS[chainId],
      underlying: UNI_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseUnits("750000", 18),
    },
  ];
  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultUNICallWithSwap", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultUNICallWithSwap @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultUNICallWithSwap"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultWithSwapLogic"];

export default main;
