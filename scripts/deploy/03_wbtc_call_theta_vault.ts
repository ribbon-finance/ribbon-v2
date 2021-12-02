import { network } from 'hardhat';
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  OptionsPremiumPricer_BYTECODE,
  BTC_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  WBTC_ADDRESS,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import {
  AUCTION_DURATION,
  KOVAN_WBTC,
  KOVAN_WBTC_ORACLE,
  MAINNET_WBTC_ORACLE,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
  WBTC_STRIKE_STEP,
  WBTC_USDC_POOL,
} from "./utils/constants";

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
  console.log(`03 - Deploying WBTC Call Theta Vault on ${network.name}`);

  const isMainnet = network.name === "mainnet";
  const manualVolOracle = await deployments.get("ManualVolOracle");

  const chainId = network.config.chainId;
  const underlyingOracle = BTC_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerWBTC", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricer_ABI,
      bytecode: OptionsPremiumPricer_BYTECODE,
    },
    args: [
      WBTC_USDC_POOL[chainId],
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  const strikeSelection = await deploy("StrikeSelectionWBTC", {
    contract: "StrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, WBTC_STRIKE_STEP],
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
    "Ribbon BTC Theta Vault",
    "rBTC-THETA",
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: false,
      decimals: 8,
      asset: WBTC_ADDRESS[chainId],
      underlying: WBTC_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(3),
      cap: parseUnits("100", 8),
    },
  ];
  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  await deploy("RibbonThetaVaultWBTCCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });
};
main.tags = ["RibbonThetaVaultWBTCCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
