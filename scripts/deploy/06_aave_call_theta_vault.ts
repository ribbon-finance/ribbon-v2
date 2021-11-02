import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  OptionsPremiumPricer_BYTECODE,
  MAINNET_USDC_ORACLE,
  KOVAN_USDC_ORACLE,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import {
  AAVE_ETH_POOL,
  AAVE_STRIKE_STEP,
  AUCTION_DURATION,
  KOVAN_AAVE,
  KOVAN_AAVE_ORACLE,
  MAINNET_AAVE,
  MAINNET_AAVE_ORACLE,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
} from "./utils/constants";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { BigNumber } = ethers;
  const { parseEther } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();
  console.log(`06 - Deploying AAVE Call Theta Vault on ${network.name}`);

  const isMainnet = network.name === "mainnet";
  const asset = isMainnet ? MAINNET_AAVE : KOVAN_AAVE;
  const manualVolOracle = await deployments.get("ManualVolOracle");

  const underlyingOracle = isMainnet ? MAINNET_AAVE_ORACLE : KOVAN_AAVE_ORACLE;
  const stablesOracle = isMainnet ? MAINNET_USDC_ORACLE : KOVAN_USDC_ORACLE;

  const pricer = await deploy("OptionsPremiumPricerAAVE", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricer_ABI,
      bytecode: OptionsPremiumPricer_BYTECODE,
    },
    args: [
      AAVE_ETH_POOL,
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  const strikeSelection = await deploy("StrikeSelectionAAVE", {
    contract: "StrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, AAVE_STRIKE_STEP],
  });

  const logicDeployment = await deployments.get("RibbonThetaVaultLogic");
  const lifecycle = await deployments.get("VaultLifecycle");

  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
    libraries: {
      VaultLifecycle: lifecycle.address,
    },
  });

  const initArgs = [
    owner,
    keeper,
    feeRecipient,
    MANAGEMENT_FEE,
    PERFORMANCE_FEE,
    "Ribbon Aave Theta Vault",
    "rAAVE-THETA",
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: false,
      decimals: 18,
      asset,
      underlying: asset,
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("15500"),
    },
  ];
  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  await deploy("RibbonThetaVaultAAVECall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
    gasPrice: ethers.utils.parseUnits("170", "gwei"),
  });
};
main.tags = ["RibbonThetaVaultAAVECall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
