import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  NEAR_ADDRESS,
  USDC_PRICE_ORACLE,
  NEAR_PRICE_ORACLE,
  NEAR_USDC_POOL,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
  NEAR_STRIKE_STEP,
} from "../utils/constants";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { BigNumber } = ethers;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } = await getNamedAccounts();
  console.log(`11 - Deploying NEAR Call Theta Vault on ${network.name}`);

  const chainId = network.config.chainId;

  if (chainId !== CHAINID.AURORA_MAINNET) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = NEAR_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerNEAR", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [
      NEAR_USDC_POOL[chainId],
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  console.log(`RibbonThetaVaultNEARCall pricer @ ${pricer.address}`);

  const strikeSelection = await deploy("StrikeSelectionNEAR", {
    contract: "DeltaStrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, NEAR_STRIKE_STEP],
  });

  console.log(`RibbonThetaVaultNEARCall strikeSelection @ ${strikeSelection.address}`);

  // Assumes these contracts are already deployed
  const lifecycle = await deployments.get("VaultLifecycle");
  const logicDeployment = await deployments.get("RibbonThetaVaultLogic");
  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
      libraries: { VaultLifecycle: lifecycle.address }
  });

  const TOKEN_NAME = 'Ribbon NEAR Theta Vault';
  const TOKEN_SYMBOL = 'rNEAR-THETA';

  const initArgs = [
    {
      _owner: owner,
      _keeper: keeper,
      _feeRecipient: feeRecipient,
      _managementFee: MANAGEMENT_FEE,
      _performanceFee: PERFORMANCE_FEE,
      _tokenName: TOKEN_NAME,
      _tokenSymbol: TOKEN_SYMBOL,
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _isUsdcAuction: false,
      _swapPath: 0x0,
    },
    {
      isPut: false,
      decimals: 24,
      asset: NEAR_ADDRESS[chainId],
      underlying: NEAR_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(16),
      cap: ethers.utils.parseUnits("1000", 24),
    },
  ];

  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultNEARCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultNEARCall @ ${proxy.address}`);
};
main.tags = ["RibbonThetaVaultAurora"];
export default main;
