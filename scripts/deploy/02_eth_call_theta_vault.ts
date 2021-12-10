import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  WETH_ADDRESS,
  ETH_USDC_POOL,
  USDC_PRICE_ORACLE,
  ETH_PRICE_ORACLE,
  OptionsPremiumPricer_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import {
  AUCTION_DURATION,
  AVAX_STRIKE_STEP,
  ETH_STRIKE_STEP,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
} from "../utils/constants";

const TOKEN_NAME = {
  [CHAINID.ETH_MAINNET]: 'Ribbon ETH Theta Vault',
  [CHAINID.ETH_KOVAN]: 'Ribbon ETH Theta Vault',
  [CHAINID.AVAX_MAINNET]: 'Ribbon AVAX Theta Vault',
  [CHAINID.AVAX_FUJI]: 'Ribbon AVAX Theta Vault',
};

const TOKEN_SYMBOL = {
  [CHAINID.ETH_MAINNET]: 'rETH-THETA',
  [CHAINID.ETH_KOVAN]: 'rETH-THETA',
  [CHAINID.AVAX_MAINNET]: 'rAVAX-THETA',
  [CHAINID.AVAX_FUJI]: 'rAVAX-THETA',
};

const STRIKE_STEP = {
  [CHAINID.ETH_MAINNET]: ETH_STRIKE_STEP,
  [CHAINID.ETH_KOVAN]: ETH_STRIKE_STEP,
  [CHAINID.AVAX_MAINNET]: AVAX_STRIKE_STEP,
  [CHAINID.AVAX_FUJI]: AVAX_STRIKE_STEP,
};

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

  const chainId = network.config.chainId;

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = ETH_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerETH", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricer_ABI,
      bytecode: OptionsPremiumPricer_BYTECODE,
    },
    args: [
      ETH_USDC_POOL[chainId],
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  console.log(`RibbonThetaVaultETHCall pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("StrikeSelectionETH", {
    contract: "StrikeSelection",
    from: deployer,
    args: [
      pricer.address,
      STRIKE_DELTA,
      STRIKE_STEP[chainId],
    ],
  });

  console.log(`RibbonThetaVaultETHCall strikeSelection @ ${strikeSelection.address}`);

  try {
    await run('verify:verify', {
      address: strikeSelection.address,
      constructorArguments: [
        pricer.address,
        STRIKE_DELTA,
        STRIKE_STEP[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }

  const logicDeployment = await deployments.get("RibbonThetaVaultLogic");
  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault");

  const initArgs = [
    {
      _owner: owner,
      _keeper: keeper,
      _feeRecipient: feeRecipient,
      _managementFee: MANAGEMENT_FEE,
      _performanceFee: PERFORMANCE_FEE,
      _tokenName: TOKEN_NAME[chainId],
      _tokenSymbol: TOKEN_SYMBOL[chainId],
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _isUsdcAuction: false,
      _swapPath: 0x0,
    },
    {
      isPut: false,
      decimals: 18,
      asset: WETH_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];

  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultETHCall Proxy @ ${proxy.address}`);

  try {
    await run('verify:verify', {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultETHCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
