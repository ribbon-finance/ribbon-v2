import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  WETH_ADDRESS,
  USDC_PRICE_ORACLE,
  ETH_PRICE_ORACLE,
  ETH_USDC_POOL,
  OptionsPremiumPricer_BYTECODE,
  YVUSDC_V0_4_3,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import {
  AUCTION_DURATION,
  ETH_STRIKE_STEP,
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
  const { BigNumber } = ethers;
  const { parseEther } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();
  console.log(`09 - Deploying yvUSDC ETH Put Theta Vault on ${network.name}`);

  const chainId = network.config.chainId;
  const manualVolOracle = await deployments.get("ManualVolOracle");

  const underlyingOracle = ETH_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const TOKEN_NAME = "Ribbon yvUSDC Theta Vault ETH Put";
  const TOKEN_SYMBOL = "ryvUSDC-ETH-P-THETA";

  const pricer = await deployments.get("OptionsPremiumPricerETH");
  const strikeSelection = await deployments.get("StrikeSelectionETH");

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
      isPut: true,
      decimals: 6,
      asset: YVUSDC_V0_4_3, // new yvUSDC
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(3),
      cap: ethers.utils.parseUnits("1000000", 6),
    },
  ];

  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const vault = await deploy("RibbonThetaVaultETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultETHCall @ ${vault.address}`);
};
main.tags = ["RibbonThetaVaultETHCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
