import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WETH_ADDRESS,
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
  EASY_AUCTION_KOVAN,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";

const ETH_USDC_POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
const MAINNET_ETH_ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const KOVAN_ETH_ORACLE = "0x0c15Ab9A0DB086e062194c273CC79f41597Bbf13";
const KOVAN_WETH = "0xd0A1E359811322d97991E03f863a0C30C2cF029C";
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
  const { parseEther } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, admin, feeRecipient } = await getNamedAccounts();
  console.log(`01 - Deploying ETH Call Theta Vault on ${network.name}`);

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
    args: [pricer.address, STRIKE_DELTA, STRIKE_STEP],
  });

  const lifecycle = await deploy("VaultLifecycle", {
    contract: "VaultLifecycle",
    from: deployer,
  });

  const weth = isMainnet ? WETH_ADDRESS : KOVAN_WETH;

  const logicDeployment = await deploy("RibbonThetaVaultETHCallLogic", {
    contract: "RibbonThetaVault",
    from: deployer,
    args: [
      weth,
      isMainnet ? USDC_ADDRESS : KOVAN_USDC,
      isMainnet ? OTOKEN_FACTORY : OTOKEN_FACTORY_KOVAN,
      isMainnet ? GAMMA_CONTROLLER : GAMMA_CONTROLLER_KOVAN,
      isMainnet ? MARGIN_POOL : MARGIN_POOL_KOVAN,
      isMainnet ? GNOSIS_EASY_AUCTION : EASY_AUCTION_KOVAN,
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
    "Ribbon ETH Theta Vault",
    "rETH-THETA",
    pricer.address,
    strikeSelection.address,
    50, //5% discount
    3600, // 1 hour auction duration
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
main.dependencies = ["ManualVolOracle"];

export default main;
