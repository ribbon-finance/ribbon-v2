import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { USDC_ADDRESS, WETH_ADDRESS } from "../../constants/constants";
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
  console.log(`11 - Deploying yvUSDC ETH Put Theta Vault on ${network.name}`);

  const chainId = network.config.chainId;

  const TOKEN_NAME = "Ribbon yvUSDC Theta Vault ETH Put";
  const TOKEN_SYMBOL = "ryvUSDC-ETH-P-THETA";

  const pricer = await deployments.get("OptionsPremiumPricerETH");
  const strikeSelection = await deployments.get("StrikeSelectionETH");

  const logicDeployment = await deployments.get("RibbonThetaVaultYearnLogic");
  const lifecycle = await deployments.get("VaultLifecycle");
  const lifecycleYearn = await deployments.get("VaultLifecycleYearn");

  const RibbonThetaYearnVault = await ethers.getContractFactory(
    "RibbonThetaYearnVault",
    {
      libraries: {
        VaultLifecycle: lifecycle.address,
        VaultLifecycleYearn: lifecycleYearn.address,
      },
    }
  );

  const initArgs = [
    owner,
    keeper,
    feeRecipient,
    MANAGEMENT_FEE,
    PERFORMANCE_FEE,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: true,
      decimals: 6,
      asset: USDC_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(3),
      cap: ethers.utils.parseUnits("1000000", 6),
    },
  ];

  const initData = RibbonThetaYearnVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const args = [logicDeployment.address, admin, initData];

  const vault = await deploy("RibbonThetaVaultETHPutYearn", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args,
  });

  console.log(`RibbonThetaVaultETHPutYearn @ ${vault.address}`);
  try {
    await run("verify:verify", {
      address: vault.address,
      constructorArguments: args,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultETHPutYearn"];
main.dependencies = ["RibbonThetaVaultYearnLogic"];

export default main;
