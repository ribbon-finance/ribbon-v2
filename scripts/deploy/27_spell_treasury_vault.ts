import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  SPELL_ADDRESS,
  SPELL_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_STEP,
  SPELL_STRIKE_MULTIPLIER,
} from "../utils/constants";

import { getDeltaStep } from "../../test/helpers/utils";

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
  console.log(`24 - Deploying SPELL Treasury Vault on ${network.name}`);

  const chainId = network.config.chainId;
  if (chainId !== CHAINID.ETH_MAINNET) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = SPELL_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const manualVolOracleContract = await ethers.getContractAt(
    ManualVolOracle_ABI,
    manualVolOracle.address
  );
  const optionId = await manualVolOracleContract.getOptionId(
    getDeltaStep("SPELL"),
    SPELL_ADDRESS[chainId],
    SPELL_ADDRESS[chainId],
    false
  );

  const pricer = await deploy("OptionsPremiumPricerSPELL", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [optionId, manualVolOracle.address, underlyingOracle, stablesOracle],
  });

  console.log(`RibbonTreasuryVaultSPELL pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("StrikeSelectionSPELL", {
    contract: "PercentStrikeSelection",
    from: deployer,
    args: [pricer.address, SPELL_STRIKE_MULTIPLIER, STRIKE_STEP.SPELL],
  });

  console.log(
    `RibbonTreasuryVaultSPELL strikeSelection @ ${strikeSelection.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [
        pricer.address,
        SPELL_STRIKE_MULTIPLIER,
        STRIKE_STEP.SPELL,
      ],
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
      _tokenName: "Ribbon SPELL Treasury Vault",
      _tokenSymbol: "rSPELL-TSRY",
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _period: 30,
      _maxDepositors: 30,
      _minDeposit: parseEther("50000"),
    },
    {
      isPut: false,
      decimals: 18,
      asset: SPELL_ADDRESS[chainId],
      underlying: SPELL_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("2500000000"),
    },
  ];
  const initData = RibbonTreasuryVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonTreasuryVaultSPELL", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonTreasuryVaultSPELL Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultSPELL"];
main.dependencies = []; //["ManualVolOracle", "RibbonTreasuryVaultLogic"];

export default main;
