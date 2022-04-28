import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  SAVAX_ADDRESS,
  SAVAX_USDC_POOL,
  ETH_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import {
  AUCTION_DURATION,
  MANAGEMENT_FEE,
  PERFORMANCE_FEE,
  PREMIUM_DISCOUNT,
  STRIKE_DELTA,
  STRIKE_STEP,
} from "../utils/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";

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
  console.log(`14 - Deploying sAVAX Theta Vault on ${network.name}`);

  const chainId = network.config.chainId;

  if (!(chainId === CHAINID.AVAX_MAINNET || chainId === CHAINID.AVAX_FUJI)) {
    console.log(`Error: chainId ${chainId} not supported`);
    return;
  }

  const manualVolOracle = await deployments.get("ManualVolOracle");

  const sAvaxOracle = await deploy("SAvaxOracle", {
    contract: "SAvaxOracle",
    from: deployer,
    args: [
      SAVAX_ADDRESS[chainId],
      ETH_PRICE_ORACLE[chainId], // Really WAVAX, not ETH
    ],
  });

  console.log(`SAvaxOracle @ ${sAvaxOracle.address}`);

  try {
    await run("verify:verify", {
      address: sAvaxOracle.address,
      constructorArguments: [SAVAX_ADDRESS[chainId], ETH_PRICE_ORACLE[chainId]],
    });
  } catch (error) {
    console.log(error);
  }

  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricer = await deploy("OptionsPremiumPricerSAVAX", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [
      SAVAX_USDC_POOL[chainId],
      manualVolOracle.address,
      sAvaxOracle.address,
      stablesOracle,
    ],
  });

  console.log(`RibbonThetaVaultSAVAXCall pricer @ ${pricer.address}`);

  const strikeSelection = await deploy("StrikeSelectionAVAX", {
    contract: "DeltaStrikeSelection",
    from: deployer,
    args: [pricer.address, STRIKE_DELTA, STRIKE_STEP.AVAX],
  });

  console.log(
    `RibbonThetaVaultSAVAXCall strikeSelection @ ${strikeSelection.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelection.address,
      constructorArguments: [pricer.address, STRIKE_DELTA, STRIKE_STEP.AVAX],
    });
  } catch (error) {
    console.log(error);
  }

  // Assumes these contracts are already deployed
  const lifecycle = await deployments.get("VaultLifecycle");
  const logicDeployment = await deployments.get("RibbonThetaVaultLogic");
  const RibbonThetaVault = await ethers.getContractFactory("RibbonThetaVault", {
    libraries: { VaultLifecycle: lifecycle.address },
  });

  const TOKEN_NAME = "Ribbon sAVAX Theta Vault";
  const TOKEN_SYMBOL = "rsAVAX-THETA";

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
      isPut: false,
      decimals: 18,
      asset: SAVAX_ADDRESS[chainId],
      underlying: SAVAX_ADDRESS[chainId],
      minimumSupply: BigNumber.from(10).pow(10),
      cap: ethers.utils.parseEther("1000"),
    },
  ];

  const initData = RibbonThetaVault.interface.encodeFunctionData(
    "initialize",
    initArgs
  );

  const proxy = await deploy("RibbonThetaVaultSAVAXCall", {
    contract: "AdminUpgradeabilityProxy",
    from: deployer,
    args: [logicDeployment.address, admin, initData],
  });

  console.log(`RibbonThetaVaultSAVAXCall Proxy @ ${proxy.address}`);

  try {
    await run("verify:verify", {
      address: proxy.address,
      constructorArguments: [logicDeployment.address, admin, initData],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["RibbonThetaVaultSAVAXCall"];

export default main;
