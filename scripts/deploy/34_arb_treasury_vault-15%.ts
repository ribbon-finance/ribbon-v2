import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  ARB_ADDRESS,
} from "../../constants/constants";
import {
  AUCTION_DURATION,
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
  const { parseEther } = ethers.utils;
  const { deploy } = deployments;
  const { deployer, owner, keeper, admin, feeRecipient } =
    await getNamedAccounts();
  console.log(`34 - Deploying ARB Treasury Vault 15% on ${network.name}`);

  const chainId = network.config.chainId;
  if (chainId !== CHAINID.ARB_MAINNET) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const pricer = await deployments.get("OptionsPremiumPricerARB");

  const strikeSelection = await deploy("ManualStrikeSelectionARB-15%", {
    contract: "ManualStrikeSelection",
    from: deployer,
    args: [],
  });

  console.log(
    `RibbonTreasuryVaultARB strikeSelection @ ${strikeSelection.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [],
    });
  } catch (error) {
    console.log(error);
  }

  const logicDeployment = await deployments.get("RibbonTreasuryVaultV2Logic");
  const lifecycle = await deployments.get("VaultLifecycleTreasury");

  const RibbonTreasuryVault = await ethers.getContractFactory(
    "RibbonTreasuryVaultV2",
    {
      libraries: {
        VaultLifecycleTreasury: lifecycle.address,
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
      _tokenName: "Ribbon ARB Treasury Vault",
      _tokenSymbol: "rARB-TSRY",
      _optionsPremiumPricer: pricer.address,
      _strikeSelection: strikeSelection.address,
      _premiumDiscount: PREMIUM_DISCOUNT,
      _auctionDuration: AUCTION_DURATION,
      _period: 30,
      _maxDepositors: 30,
      _minDeposit: parseEther("50000"),
    },
    {
      isPut: false,
      decimals: 18,
      asset: ARB_ADDRESS[chainId],
      underlying: ARB_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: parseEther("2000000"),
    },
  ];
  const initData = RibbonTreasuryVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonTreasuryVaultARB-15%", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonTreasuryVaultARB Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonTreasuryVaultARB-15%"];
main.dependencies = []; //["OptionsPremiumPricerARB", "RibbonTreasuryVaultV2Logic"];

export default main;
