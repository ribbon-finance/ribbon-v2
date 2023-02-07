import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WBTC_ADDRESS,
  BTC_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";
import {
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
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
    `19 - Deploying WBTC Call Theta Vault With Swap on ${network.name}`
  );

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const vaultDeploymentEventEmitter = await deployments.get("VaultDeploymentEventEmitter");
  const chainId = network.config.chainId;
  const underlyingOracle = BTC_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const manualVolOracleContract = await ethers.getContractAt(
    ManualVolOracle_ABI,
    manualVolOracle.address
  );

  const vaultDeploymentEventEmitterContract = await ethers.getContractAt(
    "IVaultDeploymentEventEmitter",
    vaultDeploymentEventEmitter.address
  );
  const optionId = await manualVolOracleContract.getOptionId(
    getDeltaStep("WBTC"),
    WBTC_ADDRESS[chainId],
    WBTC_ADDRESS[chainId],
    false
  );

  const pricer = await deploy("OptionsPremiumPricerWBTCWithSwap", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [optionId, manualVolOracle.address, underlyingOracle, stablesOracle],
  });

  console.log(`RibbonThetaVaultWBTCCall pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("ManualStrikeSelectionWBTCCall", {
    contract: "ManualStrikeSelection",
    from: deployer,
    args: [],
  });

  console.log(
    `RibbonThetaVaultWBTCCall strikeSelection @ ${strikeSelection.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [],
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
      _tokenName: "Ribbon BTC Theta Vault",
      _tokenSymbol: "rBTC-THETA",
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT, // deprecated in future swap vault scripts since using paradigm (e.g. 29_uni)
    },
    {
      isPut: false,
      decimals: 8,
      asset: WBTC_ADDRESS[chainId],
      underlying: WBTC_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(3),
      cap: parseUnits("5", 8),
    },
  ];
  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultWBTCCallWithSwap", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  await vaultDeploymentEventEmitterContract.newVault(proxy.address, 0); // Always adjust to the correct type of vault: 0-normal; 1-earn; 2-vip; 3-treasury

  console.log(`RibbonThetaVaultWBTCCallWithSwap @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultWBTCCallWithSwap"];
// main.dependencies = ["VaultDeploymentEventEmitter", "ManualVolOracle", "RibbonThetaVaultWithSwapLogic"];

export default main;
