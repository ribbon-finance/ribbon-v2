import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID, WETH_ADDRESS } from "../../constants/constants";
import { MANAGEMENT_FEE, PERFORMANCE_FEE } from "../utils/constants";

const TOKEN_NAME = {
  [CHAINID.ETH_MAINNET]: "Ribbon ETH Call Delta Vault",
  [CHAINID.ETH_KOVAN]: "Ribbon ETH Call Delta Vault",
  [CHAINID.AVAX_MAINNET]: "Ribbon AVAX Call Delta Vault",
  [CHAINID.AVAX_FUJI]: "Ribbon AVAX Call Delta Vault",
};

const TOKEN_SYMBOL = {
  [CHAINID.ETH_MAINNET]: "rETH-C-DELTA",
  [CHAINID.ETH_KOVAN]: "rETH-C-DELTA",
  [CHAINID.AVAX_MAINNET]: "AVAX-C-DELTA",
  [CHAINID.AVAX_FUJI]: "rAVAX-C-DELTA",
};

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

  const chainId = network.config.chainId;

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
    TOKEN_NAME[chainId],
    TOKEN_SYMBOL[chainId],
    counterpartyThetaVault,
    optionAllocation,
    {
      isPut: false,
      decimals: 18,
      asset: WETH_ADDRESS[chainId],
      underlying: WETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];
  const initData = RibbonDeltaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const vault = await deploy("RibbonDeltaVaultETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonDeltaVaultETHCall @ ${vault.address}`);

  try {
    await run("verify:verify", {
      address: vault.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonDeltaVaultETHCall"];
main.dependencies = ["RibbonDeltaVaultLogic"];

export default main;
