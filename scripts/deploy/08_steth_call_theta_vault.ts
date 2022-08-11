import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID, WETH_ADDRESS } from "../../constants/constants";
import { MANAGEMENT_FEE, PERFORMANCE_FEE } from "../utils/constants";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  if (chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI) {
    console.log(
      `08 - Skipping deployment stETH Call Theta Vault on ${network.name} because no stEth on Avax`
    );
    return;
  }

  const { BigNumber } = ethers;
  const { parseEther } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();

  console.log(`08 - Deploying stETH Call Theta Vault on ${network.name}`);

  const pricer = await deployments.get("OptionsPremiumPricerETHCall");

  const strikeSelection = await deployments.get("StrikeSelectionETHCall");

  const logicDeployment = await deployments.get("RibbonThetaVaultSTETHLogic");
  const lifecycle = await deployments.get("VaultLifecycleWithSwap");
  const lifecycleSTETH = await deployments.get("VaultLifecycleSTETH");

  const RibbonThetaSTETHVault = await ethers.getContractFactory(
    "RibbonThetaSTETHVault",
    {
      libraries: {
        VaultLifecycleWithSwap: lifecycle.address,
        VaultLifecycleSTETH: lifecycleSTETH.address,
      },
    }
  );

  const initArgs = [
    [
      owner,
      keeper,
      feeRecipient,
      MANAGEMENT_FEE,
      PERFORMANCE_FEE,
      "Ribbon stETH Theta Vault",
      "rstETH-THETA",
      pricer.address,
      strikeSelection.address,
    ],
    {
      isPut: false,
      decimals: 18,
      asset: WETH_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];
  const initData = RibbonThetaSTETHVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultSTETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultSTETHCall Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultSTETHCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultSTETHLogic"];

export default main;
