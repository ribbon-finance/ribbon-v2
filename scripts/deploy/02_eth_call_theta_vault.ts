import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WETH_ADDRESS,
  OptionsPremiumPricer_BYTECODE,
  MAINNET_USDC_ORACLE,
  KOVAN_USDC_ORACLE,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";

const ETH_USDC_POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
const MAINNET_ETH_ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const KOVAN_ETH_ORACLE = "0x9326BFA02ADD2366b30bacB125260Af641031331";
const KOVAN_WETH = "0xd0A1E359811322d97991E03f863a0C30C2cF029C";

const STRIKE_STEP = 100;
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
    args: [pricer.address, STRIKE_DELTA, STRIKE_STEP],
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
    0,
    0,
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
