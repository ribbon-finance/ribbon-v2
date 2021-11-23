import { HardhatRuntimeEnvironment } from "hardhat/types";
import { WETH_ADDRESS } from "../../constants/constants";
import {
  AUCTION_DURATION,
  KOVAN_WETH,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
} from "./utils/constants";

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
  console.log(`08 - Deploying stETH Call Theta Vault on ${network.name}`);

  const isMainnet = network.name === "mainnet";

  const pricer = await deployments.get("OptionsPremiumPricerETH");

  const strikeSelection = await deployments.get("StrikeSelectionETH");

  const weth = isMainnet ? WETH_ADDRESS : KOVAN_WETH;

  const logicDeployment = await deployments.get("RibbonThetaVaultSTETHLogic");
  const lifecycle = await deployments.get("VaultLifecycle");
  const lifecycleSTETH = await deployments.get("VaultLifecycleSTETH");

  const RibbonThetaSTETHVault = await ethers.getContractFactory(
    "RibbonThetaSTETHVault",
    {
      libraries: {
        VaultLifecycle: lifecycle.address,
        VaultLifecycleSTETH: lifecycleSTETH.address,
      },
    }
  );

  const initArgs = [
    owner,
    keeper,
    feeRecipient,
    MANAGEMENT_FEE,
    PERFORMANCE_FEE,
    "Ribbon stETH Theta Vault",
    "rstETH-THETA",
    pricer.address,
    strikeSelection.address,
    PREMIUM_DISCOUNT,
    AUCTION_DURATION,
    {
      isPut: false,
      decimals: 18,
      asset: weth,
      underlying: weth,
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];
  const initData = RibbonThetaSTETHVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  await deploy("RibbonThetaVaultSTETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });
};
main.tags = ["RibbonThetaVaultSTETHCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultSTETHLogic"];

export default main;
