import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  PERP_ADDRESS,
  PERP_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  PERP_ETH_POOL,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_STEP,
  PERP_STRIKE_MULTIPLIER,
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
  console.log(`13 - Deploying PERP Treasury Vault on ${network.name}`);

  const chainId = network.config.chainId;
  if (chainId !== CHAINID.ETH_MAINNET) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = PERP_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerPERP", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [
      PERP_ETH_POOL[chainId],
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  console.log(`RibbonTreasuryVaultPERP pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("StrikeSelectionPERP", {
    contract: "PercentStrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_STEP.PERP, PERP_STRIKE_MULTIPLIER], //change this
  });

  console.log(
    `RibbonTreasuryVaultPERP strikeSelection @ ${strikeSelection.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [
        pricer.address,
        STRIKE_STEP.PERP,
        PERP_STRIKE_MULTIPLIER,
      ], // change this
    });
  } catch (error) {
    console.log(error);
  }

  const logicDeployment = await deployments.get("RibbonTreasuryVaultLogic");
  const lifecycle = await deployments.get("VaultLifecycleTreasury");

  const RibbonTreasuryVault = await ethers.getContractFactory(
    "RibbonTreasuryVault",
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
      _tokenName: "Ribbon PERP Treasury Vault",
      _tokenSymbol: "rPERP-TSRY",
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _period: 30,
      _maxDepositors: 30,
      _minDeposit: parseEther("100"),
    },
    {
      isPut: false,
      decimals: 18,
      asset: PERP_ADDRESS[chainId],
      underlying: PERP_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("200000"),
    },
  ];
  const initData = RibbonTreasuryVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonTreasuryVaultPERP", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonTreasuryVaultPERP Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultPERP"];
main.dependencies = ["ManualVolOracle", "RibbonTreasuryVaultLogic"];

export default main;
