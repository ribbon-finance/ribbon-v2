import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  OptionsPremiumPricer_BYTECODE,
  MAINNET_USDC_ORACLE,
  KOVAN_USDC_ORACLE,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  OTOKEN_FACTORY_KOVAN,
  GAMMA_CONTROLLER,
  GAMMA_CONTROLLER_KOVAN,
  MARGIN_POOL,
  MARGIN_POOL_KOVAN,
  GNOSIS_EASY_AUCTION,
  WBTC_ADDRESS,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";

const WBTC_USDC_POOL = "0x99ac8cA7087fA4A2A1FB6357269965A2014ABc35";
const MAINNET_WBTC_ORACLE = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const KOVAN_WBTC_ORACLE = "0x6135b13325bfC4B00278B4abC5e20bbce2D6580e";
const KOVAN_WETH = "0xd0A1E359811322d97991E03f863a0C30C2cF029C";
const KOVAN_WBTC = "0x50570256f0da172a1908207aAf0c80d4b279f303";
const KOVAN_USDC = "0x7e6edA50d1c833bE936492BF42C1BF376239E9e2";

const STRIKE_STEP = 100;
const STRIKE_DELTA = 1000; // 0.1d

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { BigNumber } = ethers;
  const { parseUnits } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, admin, feeRecipient } = await getNamedAccounts();
  console.log(`02 - Deploying WBTC Call Theta Vault on ${network.name}`);

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

  const strikeSelection = await deploy("StrikeSelectionETH", {
    contract: "StrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, STRIKE_STEP],
  });

  const lifecycle = await deploy("VaultLifecycle", {
    contract: "VaultLifecycle",
    from: deployer,
  });

  const wbtc = isMainnet ? WBTC_ADDRESS : KOVAN_WBTC;

  const logicDeployment = await deploy("RibbonThetaVaultWBTCCallLogic", {
    contract: "RibbonThetaVault",
    from: deployer,
    args: [
      wbtc,
      isMainnet ? USDC_ADDRESS : KOVAN_USDC,
      isMainnet ? OTOKEN_FACTORY : OTOKEN_FACTORY_KOVAN,
      isMainnet ? GAMMA_CONTROLLER : GAMMA_CONTROLLER_KOVAN,
      isMainnet ? MARGIN_POOL : MARGIN_POOL_KOVAN,
      isMainnet ? GNOSIS_EASY_AUCTION : GNOSIS_EASY_AUCTION,
    ],
    libraries: {
      VaultLifecycle: lifecycle.address,
    },
  });

  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
    libraries: {
      VaultLifecycle: lifecycle.address,
    },
  });

  const initArgs = [
    owner,
    feeRecipient,
    0,
    0,
    "Ribbon BTC Theta Vault",
    "rBTC-THETA",
    pricer.address,
    strikeSelection.address,
    50, // 5% discount
    3600, // 1 hour auction duration
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
main.dependencies = ["ManualVolOracle"];

export default main;
