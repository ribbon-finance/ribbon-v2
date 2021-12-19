import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  BZRX_ADDRESS,
  BZRX_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  BZRX_ETH_POOL, 
  ETH_PRICE_ORACLE,
  OptionsPremiumPricerInNative_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInNative_ABI from "../../constants/abis/OptionsPremiumPricerInNative.json";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  BZRX_STRIKE_STEP,
  BZRX_STRIKE_MULTIPLIER
} from "../utils/constants";

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
  console.log(`10 - Deploying BZRX Treasury Vault on ${network.name}`);

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const chainId = network.config.chainId;
  const underlyingOracle = BZRX_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];
  const nativeOracle = ETH_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerBZRX", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInNative_ABI,
      bytecode: OptionsPremiumPricerInNative_BYTECODE,
    },
    args: [
      BZRX_ETH_POOL,
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
      nativeOracle,
    ],
  });

  console.log(`RibbonTreasuryVaultBZRX pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("StrikeSelectionBZRX", {
    contract: "PercentStrikeSelection",
    from: deployer,
    args: [pricer.address, BZRX_STRIKE_STEP, BZRX_STRIKE_MULTIPLIER], //change this
  });

  console.log(`RibbonTreasuryVaultBZRX strikeSelection @ ${strikeSelection.address}`);

  if (chainId !== 42) {
    try {
      await run('verify:verify', {
        address: strikeSelection.address,
        constructorArguments: [pricer.address, BZRX_STRIKE_STEP, BZRX_STRIKE_MULTIPLIER], // change this
      });
    } catch (error) {
      console.log(error);
    }
  }

  const logicDeployment = await deployments.get("RibbonTreasuryVaultLogic");
  const lifecycle = await deployments.get("VaultLifecycleTreasury");

  const RibbonTreasuryVault = await ethers.getContractFactory("RibbonTreasuryVault", 
    {
      libraries: {
        VaultLifecycleTreasury: lifecycle.address,
      },
    }
  );

  const initArgs = [ 
    {
      _owner: owner,
      _keeper: keeper,
      _feeRecipient: feeRecipient,
      _managementFee: MANAGEMENT_FEE,
      _performanceFee: PERFORMANCE_FEE,
      _tokenName: "Ribbon BZRX Treasury Vault",
      _tokenSymbol: "rBZRX-TSRY",
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _whitelist: [keeper],
      _period: 14,
    },
    {
      isPut: false,
      decimals: 18,
      asset: BZRX_ADDRESS[chainId],
      underlying: BZRX_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];
  const initData = RibbonTreasuryVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );
  
  const proxy = await deploy("RibbonTreasuryVaultBZRX", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonTreasuryVaultBZRX Proxy @ ${proxy.address}`);

  if (chainId !== 42) {
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
  }
};
main.tags = ["RibbonTreasuryVaultBZRX"];
main.dependencies = ["ManualVolOracle", "RibbonTreasuryVaultLogic"];

export default main;
