import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  USDC_PRICE_ORACLE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import {
  AAVE_ETH_POOL,
  AAVE_STRIKE_STEP,
  AUCTION_DURATION,
  KOVAN_AAVE,
  KOVAN_AAVE_ORACLE,
  MAINNET_AAVE,
  MAINNET_AAVE_ORACLE,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
} from "../utils/constants";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  if (chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI) {
    console.log(
      `06 - Skipping deployment AAVE Call Theta Vault on ${network.name}`
    );
    return;
  }

  const { BigNumber } = ethers;
  const { parseEther } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();
  console.log(`06 - Deploying AAVE Call Theta Vault on ${network.name}`);

  const isMainnet = network.name === "mainnet";

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = isMainnet ? MAINNET_AAVE_ORACLE : KOVAN_AAVE_ORACLE;
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerAAVE", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [
      AAVE_ETH_POOL,
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  const strikeSelection = await deploy("StrikeSelectionAAVE", {
    contract: "DeltaStrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, AAVE_STRIKE_STEP],
  });

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
      _tokenName: "Ribbon Aave Theta Vault",
      _tokenSymbol: "rAAVE-THETA",
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
      asset: isMainnet ? MAINNET_AAVE : KOVAN_AAVE,
      underlying: isMainnet ? MAINNET_AAVE : KOVAN_AAVE,
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("15500"),
    },
  ];
  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const vault = await deploy("RibbonThetaVaultAAVECall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultAAVECall @ ${vault.address}`);

  try {
    await run('verify:verify', {
      address: vault.address,
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
main.tags = ["RibbonThetaVaultAAVECall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
