import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  OptionsPremiumPricer_BYTECODE,
  MAINNET_USDC_ORACLE,
  KOVAN_USDC_ORACLE,
  WBTC_ADDRESS,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";

const WBTC_USDC_POOL = "0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35";
const MAINNET_WBTC_ORACLE = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const KOVAN_WBTC_ORACLE = "0x6135b13325bfC4B00278B4abC5e20bbce2D6580e";
const KOVAN_WBTC = "0x50570256f0da172a1908207aAf0c80d4b279f303";

const STRIKE_STEP = 1000;
const STRIKE_DELTA = 1000; // 0.1d
const PREMIUM_DISCOUNT = 950; // 0.95
const AUCTION_DURATION = 3600; // 1 hour

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

  const underlyingOracle = isMainnet ? MAINNET_WBTC_ORACLE : KOVAN_WBTC_ORACLE;
  const stablesOracle = isMainnet ? MAINNET_USDC_ORACLE : KOVAN_USDC_ORACLE;

  const pricer = await deploy("OptionsPremiumPricerWBTC", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricer_ABI,
      bytecode: OptionsPremiumPricer_BYTECODE,
    },
    args: [
      WBTC_USDC_POOL,
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  const strikeSelection = await deploy("StrikeSelectionWBTC", {
    contract: "StrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, STRIKE_STEP],
  });

  const wbtc = isMainnet ? WBTC_ADDRESS : KOVAN_WBTC;
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
    0,
    0,
    "Ribbon BTC Theta Vault",
    "rBTC-THETA",
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: false,
      decimals: 8,
      asset: wbtc,
      underlying: wbtc,
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
