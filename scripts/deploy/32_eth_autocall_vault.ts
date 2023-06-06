import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  USDC_PRICE_ORACLE,
  OptionsPremiumPricerInStables_BYTECODE,
  ETH_PRICE_ORACLE,
  WETH_ADDRESS,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";
import { AUCTION_DURATION, PREMIUM_DISCOUNT } from "../utils/constants";

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
  console.log(`32 - Deploying ETH Autocall Vault on ${network.name}`);

  const chainId = network.config.chainId;
  if (chainId !== CHAINID.ETH_MAINNET) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = ETH_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const manualVolOracleContract = await ethers.getContractAt(
    ManualVolOracle_ABI,
    manualVolOracle.address
  );
  const optionId = await manualVolOracleContract.getOptionId(
    getDeltaStep("WETH"),
    WETH_ADDRESS[chainId],
    USDC_ADDRESS[chainId],
    true
  );

  const pricer = await deploy("OptionsPremiumPricerWETH", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [optionId, manualVolOracle.address, underlyingOracle, stablesOracle],
  });

  console.log(`AutocallVaultWETH pricer @ ${pricer.address}`);

  // Can't verify pricer because it's compiled with 0.7.3

  const strikeSelection = await deploy("ManualStrikeSelectionAutocall", {
    contract: "ManualStrikeSelection",
    from: deployer,
    args: [],
  });

  console.log(`AutocallVaultWETH strikeSelection @ ${strikeSelection.address}`);

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [],
    });
  } catch (error) {
    console.log(error);
  }

  const lifecycleTreasury = await deploy("VaultLifecycleTreasury", {
    contract: "VaultLifecycleTreasury",
    from: deployer,
  });
  console.log(`VaultLifeCycleTreasury @ ${lifecycleTreasury.address}`);

  // deploy logic
  const logicDeployment = await deploy("RibbonAutocallVault", {
    contract: "RibbonAutocallVault",
    from: deployer,
    args: [
      USDC_ADDRESS[chainId],
      OTOKEN_FACTORY[chainId],
      GAMMA_CONTROLLER[chainId],
      MARGIN_POOL[chainId],
    ],
    libraries: {
      VaultLifecycleTreasury: lifecycleTreasury.address,
    },
  });

  console.log(`AutocallVault Logic @ ${logicDeployment.address}`);

  try {
    await run("verify:verify", {
      address: lifecycleTreasury.address,
      constructorArguments: [],
    });
  } catch (error) {
    console.log(error);
  }

  try {
    await run("verify:verify", {
      address: logicDeployment.address,
      constructorArguments: [
        USDC_ADDRESS[chainId],
        OTOKEN_FACTORY[chainId],
        GAMMA_CONTROLLER[chainId],
        MARGIN_POOL[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }

  // Autocall vault specific initArgs
  const initOptionType = 0;
  const initCouponType = 3;
  const initAB = 10500;
  const initNAB = 10500;
  const initCB = 10500;
  const initNCB = 10500;
  const obsFreq = 518400; // 6 days
  const autocallSeller = "0x0000000000000000000000000000000000000001";

  const initArgs = [
    {
      _owner: owner,
      _keeper: keeper,
      _feeRecipient: feeRecipient,
      _managementFee: 0,
      _performanceFee: 0,
      _tokenName: "ETH Autocall Vault",
      _tokenSymbol: "ETH-AUTO",
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _period: 30,
      _maxDepositors: 10,
      _minDeposit: parseEther("10"),
    },
    {
      isPut: true,
      decimals: 18,
      asset: USDC_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1500"),
    },
    initOptionType,
    [
      initCouponType,
      initCouponType,
      initAB,
      initNAB,
      initCB,
      initNCB,
    ],
    obsFreq,
    autocallSeller,
  ];

  const AutocallVault = await ethers.getContractFactory("RibbonAutocallVault", {
    libraries: {
      VaultLifecycleTreasury: lifecycleTreasury.address,
    },
  });

  const initData = AutocallVault.interface.encodeFunctionData(
    "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)",
    initArgs
  );

  const proxy = await deploy("AutocallVaultWETH", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`AutocallVaultWETH Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["AutocallVaultWETH"];
main.dependencies = []; // ["ManualVolOracle"];

export default main;
