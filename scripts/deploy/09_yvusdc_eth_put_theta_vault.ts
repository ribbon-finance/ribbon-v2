import { HardhatRuntimeEnvironment } from "hardhat/types";
import { WETH_ADDRESS, YVUSDC_V0_4_3 } from "../../constants/constants";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
} from "../utils/constants";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { BigNumber } = ethers;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();
  console.log(`09 - Deploying yvUSDC ETH Put Theta Vault on ${network.name}`);

  const chainId = network.config.chainId;

  const TOKEN_NAME = "Ribbon yvUSDC Theta Vault ETH Put";
  const TOKEN_SYMBOL = "ryvUSDC-ETH-P-THETA";

  const pricer = await deployments.get("OptionsPremiumPricerETH");
  const strikeSelection = await deployments.get("StrikeSelectionETH");

  const logicDeployment = await deployments.get("RibbonThetaVaultYearnLogic");
  const lifecycle = await deployments.get("VaultLifecycle");
  const lifecycleYearn = await deployments.get("VaultLifecycleYearn");

  const RibbonThetaVault = await ethers.getContractFactory(
    "RibbonThetaVaultYearnLogic",
    {
      libraries: {
        VaultLifecycle: lifecycle.address,
        VaultLifecycleYearn: lifecycleYearn.address,
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

  const vault = await deploy("RibbonThetaVaultETHPutYearn", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultETHPutYearn @ ${vault.address}`);
};
main.tags = ["RibbonThetaVaultETHPutYearn"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultYearnLogic"];

export default main;
