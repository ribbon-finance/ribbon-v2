import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  SAMB_ADDRESS,
} from "../../constants/constants";
import {
  AUCTION_DURATION,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  ONE_ADDRESS,
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
  console.log(`28 - Deploying SAMB Treasury Vault on ${network.name}`);

  const chainId = network.config.chainId;
  if (chainId !== CHAINID.ETH_MAINNET) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const logicDeployment = await deployments.get("RibbonTreasuryVaultLogicSAMB");
  console.log(`LogicDeployment @ ${logicDeployment.address}`);
  const lifecycleAddress = logicDeployment.libraries.VaultLifecycleTreasuryBare;
  console.log(`VaultLifeCycleTreasuryBare @ ${lifecycleAddress}`);

  const RibbonTreasuryVault = await ethers.getContractFactory(
    "RibbonTreasuryVaultBare",
    {
      libraries: {
        VaultLifecycleTreasury: lifecycleAddress,
      },
    }
  );

  const initArgs = [
    {
      _owner: owner,
      _keeper: keeper,
      _feeRecipient: feeRecipient,
      _managementFee: 0,
      _performanceFee: PERFORMANCE_FEE,
      _tokenName: "Ribbon SAMB Treasury Vault",
      _tokenSymbol: "rSAMB-TSRY",
      _optionsPremiumPricer: ONE_ADDRESS,
      _strikeSelection: ONE_ADDRESS,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _period: 30,
      _maxDepositors: 30,
      _minDeposit: parseEther("5"),
    },
    {
      isPut: false,
      decimals: 18,
      asset: SAMB_ADDRESS[chainId],
      underlying: SAMB_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("2500000000"),
    },
  ];
  const initData = RibbonTreasuryVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonTreasuryVaultSAMB", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonTreasuryVaultSAMB Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultSAMB"];
main.dependencies = []; //["ManualVolOracle", "RibbonTreasuryVaultLogic"];

export default main;
