import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WBTC_ADDRESS,
  BTC_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  WBTC_USDC_POOL,
  OptionsPremiumPricer_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
  WBTC_STRIKE_STEP,
} from "../utils/constants";

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

  console.log(`RibbonThetaVaultWBTCCall pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("StrikeSelectionWBTC", {
    contract: "StrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, WBTC_STRIKE_STEP],
  });

  console.log(`RibbonThetaVaultWBTCCall strikeSelection @ ${strikeSelection.address}`);

   try {
    await run('verify:verify', {
      address: strikeSelection.address,
      constructorArguments: [pricer.address, STRIKE_DELTA, WBTC_STRIKE_STEP],
    });
  } catch (error) {
    console.log(error);
  }

  const logicDeployment = await deployments.get("RibbonThetaVaultLogic");
  const lifecycle = await deployments.get("VaultLifecycle");

  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
    libraries: {
      VaultLifecycle: lifecycle.address,
    },
  });

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
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _isUsdcAuction: false,
      _swapPath: 0x0,
    },
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

  const proxy = await deploy("RibbonThetaVaultWBTCCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultWBTCCall @ ${proxy.address}`);

  try {
    await run('verify:verify', {
      address: proxy.address,
      constructorArguments: [
        logicDeployment.address,
        admin,
        initData,
      ],
    });
  } catch (error) {
    console.log(error);
  }

};
main.tags = ["RibbonThetaVaultWBTCCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
