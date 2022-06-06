import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CHAINID, RETH_ADDRESS } from "../../constants/constants";
import {
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  AUCTION_DURATION,
} from "../utils/constants";

const main = async ({
  network,
  deployments,
  ethers,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const chainId = network.config.chainId;

  if (chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI) {
    console.log(
      `21 - Skipping deployment rETH Call Theta Vault on ${network.name} because no rETH on Avax`
    );
    return;
  }

  const { BigNumber } = ethers;
  const { parseEther } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();

  console.log(`21 - Deploying rETH Call Theta Vault on ${network.name}`);

  const pricer = "0x5ba2a42b74a72a1a3ccc37cf03802a0b7a551139" //await deployments.get("OptionsPremiumPricerETHCall");

  const strikeSelection = "0xab40513b6f0a33a68b59ccf90cb6f892b4be1573" //await deployments.get("StrikeSelectionETHCall");

  const logicDeployment = "0xd584e753e44d5cded8588821ce64196a7306f8e5" // await deployments.get("RibbonThetaVaultLogic");
  const lifecycle = "0xE6342509ae61b63F015f268953FCA0dE71e61128" //await deployments.get("VaultLifecycle");

  const RibbonThetaRETHVault = await ethers.getContractFactory(
    "RibbonThetaVault",
    {
      libraries: {
        VaultLifecycle: lifecycle,
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
    _tokenName: "Ribbon rETH Theta Vault",
    _tokenSymbol: "rrETH-THETA",
    _optionsPremiumPricer: pricer,
    _strikeSelection: strikeSelection,
    _premiumDiscount: PREMIUM_DISCOUNT,
    _auctionDuration: AUCTION_DURATION,
    },
    {
      isPut: false,
      decimals: 18,
      asset: RETH_ADDRESS[chainId],
      underlying: RETH_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("1000"),
    },
  ];
  const initData = RibbonThetaRETHVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultRETHCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment, admin, initData],
  });

  console.log(`RibbonThetaVaultRETHCall Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultRETHCall"];
main.dependencies = ["ManualVolOracle", "RibbonThetaVaultLogic"];

export default main;
