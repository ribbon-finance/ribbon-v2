import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  WETH_ADDRESS,
  USDC_ADDRESS,
  OTOKEN_FACTORY,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
} from "../../constants/constants";
import { AUCTION_DURATION, PREMIUM_DISCOUNT } from "../utils/constants";

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

  const pricer = await deployments.get("OptionsPremiumPricerETHPut");

  console.log(`AutocallVaultWETH pricer @ ${pricer.address}`);

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
  const optionType = 1; // DIP
  const couponType = 0; // FIXED
  const AB = 10000; // autocall is 100%
  const CB = 0; // FIXED requires 0 CB
  const obsFreq = 604800; // 7 days
  const autocallSeller = ""; // Marex address

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
      _auctionDuration: AUCTION_DURATION, // arbitrary value since it is not used in any case
      _period: 14, // 14 days
      _maxDepositors: 10, // arbitrary value since it is not used in any case
      _minDeposit: 0, // arbitrary since it is not used in any case
    },
    {
      isPut: true,
      decimals: 18,
      asset: USDC_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1500"),
    },
    optionType,
    [
      couponType,
      0,
      AB,
      0,
      CB,
      0,
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
