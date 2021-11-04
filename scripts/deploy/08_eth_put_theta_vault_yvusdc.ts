import { HardhatRuntimeEnvironment } from "hardhat/types";
import { WETH_ADDRESS } from "../../constants/constants";
import {
  AUCTION_DURATION,
  KOVAN_WETH,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  YVUSDC,
} from "./utils/constants";

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
  console.log(`07 - Deploying ETH Put Theta Vault Yearn on ${network.name}`);

  const isMainnet = network.name === "mainnet";
  const pricer = await deployments.get("OptionsPremiumPricerETH");
  const strikeSelection = await deployments.get("StrikeSelectionETH");

  const weth = isMainnet ? WETH_ADDRESS : KOVAN_WETH;

  const logicDeployment = await deployments.get("RibbonThetaVaultLogic");
  const lifecycle = await deployments.get("VaultLifecycle");

  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
    libraries: {
      VaultLifecycle: lifecycle.address,
    },
  });

  const initArgs = [
    owner,
    keeper,
    feeRecipient,
    MANAGEMENT_FEE,
    PERFORMANCE_FEE,
    "Ribbon yvUSDC Theta Vault ETH Put",
    "ryvUSDC-ETH-P-THETA",
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: true,
      decimals: 6,
      asset: weth,
      underlying: YVUSDC,
      minimumSupply: BigNumber.from(10).pow(3),
      cap: ethers.utils.parseUnits("1000000", 6),
    },
  ];
  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  await deploy("RibbonThetaVaultETHPutYearn", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });
};
main.tags = ["RibbonThetaVaultETHPutYearn"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
