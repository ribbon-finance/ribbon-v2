import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WETH_ADDRESS,
  OptionsPremiumPricer_BYTECODE,
  MAINNET_USDC_ORACLE,
  KOVAN_USDC_ORACLE,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import {
  AUCTION_DURATION,
  ETH_STRIKE_STEP,
  ETH_USDC_POOL,
  KOVAN_ETH_ORACLE,
  KOVAN_WETH,
  MAINNET_ETH_ORACLE,
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
  console.log(`02 - Deploying ETH Call Theta Vault on ${network.name}`);

  const isMainnet = network.name === "mainnet";
  const manualVolOracle = await deployments.get("ManualVolOracle");

  const underlyingOracle = isMainnet ? MAINNET_ETH_ORACLE : KOVAN_ETH_ORACLE;
  const stablesOracle = isMainnet ? MAINNET_USDC_ORACLE : KOVAN_USDC_ORACLE;

  const pricer = await deploy("OptionsPremiumPricerETH", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricer_ABI,
      bytecode: OptionsPremiumPricer_BYTECODE,
    },
    args: [
      ETH_USDC_POOL,
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  const strikeSelection = await deploy("StrikeSelectionETH", {
    contract: "StrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, ETH_STRIKE_STEP],
  });

  const weth = isMainnet ? WETH_ADDRESS : KOVAN_WETH;

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
    "Ribbon ETH Theta Vault",
    "rETH-THETA",
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: false,
      decimals: 18,
      asset: weth,
      underlying: weth,
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];
  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  await deploy("RibbonThetaVaultETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });
};
main.tags = ["RibbonThetaVaultETHCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
