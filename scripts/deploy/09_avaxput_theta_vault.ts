import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID, WETH_ADDRESS, USDC_ADDRESS } from "../../constants/constants";
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
  console.log(`09 - Deploying AVAX Put Theta Vault on ${network.name}`);

  const chainId = network.config.chainId;

  if (!(chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI)) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  // Assumes these contracts are already deployed
  const pricer = await deployments.get("OptionsPremiumPricerETH");
  const strikeSelection = await deployments.get("StrikeSelectionETH");
  const lifecycle = await deployments.get("VaultLifecycle");
  const logicDeployment = await deployments.get("RibbonThetaVaultLogic");
  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
    libraries: { VaultLifecycle: lifecycle.address },
  });

  const TOKEN_NAME = "Ribbon USDC Theta Vault AVAX Put";
  const TOKEN_SYMBOL = "rUSDC-AVAX-P-THETA";

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
      asset: USDC_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(3),
      cap: BigNumber.from("10000000").mul(BigNumber.from(10).pow(6)),
    },
  ];

  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultETHPut", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultETHPut Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultETHPut"];

export default main;
