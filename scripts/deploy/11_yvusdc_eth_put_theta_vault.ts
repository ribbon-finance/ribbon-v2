import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  ETH_PRICE_ORACLE,
  ETH_USDC_POOL,
  USDC_ADDRESS,
  USDC_PRICE_ORACLE,
  WETH_ADDRESS,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
  ETH_STRIKE_STEP,
} from "../utils/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { BigNumber } = ethers;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();
  console.log(`11 - Deploying yvUSDC ETH Put Theta Vault on ${network.name}`);

  const chainId = network.config.chainId;

  const TOKEN_NAME = "Ribbon yvUSDC Theta Vault ETH Put";
  const TOKEN_SYMBOL = "ryvUSDC-ETH-P-THETA";

  const logicDeployment = await deployments.get("RibbonThetaVaultYearnLogic");
  const lifecycle = await deployments.get("VaultLifecycle");
  const lifecycleYearn = await deployments.get("VaultLifecycleYearn");

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = ETH_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerETHPut", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [
      ETH_USDC_POOL[chainId],
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  console.log(`RibbonThetaVaultETHPutYearn pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("StrikeSelectionETHPut", {
    contract: "DeltaStrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, ETH_STRIKE_STEP[chainId]],
  });

  console.log(
    `RibbonThetaVaultETHPutYearn strikeSelection @ ${strikeSelection.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [
        pricer.address,
        STRIKE_DELTA,
        ETH_STRIKE_STEP[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }

  const RibbonThetaYearnVault = await ethers.getContractFactory(
    "RibbonThetaYearnVault",
    {
      libraries: {
        VaultLifecycle: lifecycle.address,
        VaultLifecycleYearn: lifecycleYearn.address,
      },
    }
  );

  const initArgs = [
    owner,
    keeper,
    feeRecipient,
    MANAGEMENT_FEE,
    PERFORMANCE_FEE,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: true,
      decimals: 6,
      asset: USDC_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(3),
      cap: ethers.utils.parseUnits("1000000", 6),
    },
  ];

  const initData = RibbonThetaYearnVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const args = [logicDeployment.address, admin, initData];

  const vault = await deploy("RibbonThetaVaultETHPutYearn", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args,
  });

  console.log(`RibbonThetaVaultETHPutYearn @ ${vault.address}`);
  try {
    await run("verify:verify", {
      address: vault.address,
      constructorArguments: args,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultETHPutYearn"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultYearnLogic"];

export default main;
