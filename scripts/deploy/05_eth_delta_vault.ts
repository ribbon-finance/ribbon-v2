import { HardhatRuntimeEnvironment } from "hardhat/types";
import { WETH_ADDRESS } from "../../constants/constants";
import { KOVAN_WETH, MANAGEMENT_FEE, PERFORMANCE_FEE } from "./utils/constants";

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
  console.log(`05 - Deploying ETH Call Delta Vault on ${network.name}`);

  const isMainnet = network.name === "mainnet";
  const weth = isMainnet ? WETH_ADDRESS : KOVAN_WETH;

  const logicDeployment = await deployments.get("RibbonDeltaVaultLogic");
  const lifecycle = await deployments.get("VaultLifecycle");

  const RibbonDeltaVault = await ethers.getContractFactory("RibbonDeltaVault", {
    libraries: {
      VaultLifecycle: lifecycle.address,
    },
  });

  const counterpartyThetaVault = (
    await deployments.get("RibbonThetaVaultETHCall")
  ).address;
  const optionAllocation = ethers.utils.parseUnits("5", 2); // 5% allocated

  const initArgs = [
    owner,
    keeper,
    feeRecipient,
    MANAGEMENT_FEE,
    PERFORMANCE_FEE,
    "Ribbon ETH Call Delta Vault",
    "rETH-C-DELTA",
    counterpartyThetaVault,
    optionAllocation,
    {
      isPut: false,
      decimals: 18,
      asset: weth,
      underlying: weth,
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];
  const initData = RibbonDeltaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  await deploy("RibbonDeltaVaultETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });
};
main.tags = ["RibbonDeltaVaultETHCall"];
main.dependencies = ["RibbonDeltaVaultLogic"];

export default main;
