import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  CHAINID,
  ETH_USDC_POOL,
  USDC_PRICE_ORACLE,
  ETH_PRICE_ORACLE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../../constants/constants";
import OptionsPremiumPricerInStables_ABI from "../../constants/abis/OptionsPremiumPricerInStables.json";
import {
  AVAX_STRIKE_STEP,
  ETH_STRIKE_STEP,
  STRIKE_DELTA,
} from "../utils/constants";

const STRIKE_STEP = {
  [CHAINID.ETH_MAINNET]: ETH_STRIKE_STEP,
  [CHAINID.ETH_KOVAN]: ETH_STRIKE_STEP,
  [CHAINID.AVAX_MAINNET]: AVAX_STRIKE_STEP,
  [CHAINID.AVAX_FUJI]: AVAX_STRIKE_STEP,
  [CHAINID.AURORA_MAINNET]: ETH_STRIKE_STEP,
};

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } =
    await getNamedAccounts();
  console.log(`xx - Deploying ETH Strike Selection on ${network.name}`);

  const chainId = network.config.chainId;

  const manualVolOracle = await deployments.get("ManualVolOracle");
  const underlyingOracle = ETH_PRICE_ORACLE[chainId];
  const stablesOracle = USDC_PRICE_ORACLE[chainId];

  const pricerCall = await deploy("OptionsPremiumPricerETHCall", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [
      ETH_USDC_POOL[chainId],
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  console.log([
    ETH_USDC_POOL[chainId],
    manualVolOracle.address,
    underlyingOracle,
    stablesOracle,
  ]);

  console.log(`OptionsPremiumPricerETHCall @ ${pricerCall.address}`);

  const strikeSelectionCall = await deploy("StrikeSelectionETHCall", {
    contract: "DeltaStrikeSelection",
    from: deployer,
    args: [pricerCall.address, STRIKE_DELTA, STRIKE_STEP[chainId]],
  });

  console.log(
    `StrikeSelectionETHCall @ ${strikeSelectionCall.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelectionCall.address,
      constructorArguments: [
        pricerCall.address,
        STRIKE_DELTA,
        STRIKE_STEP[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }


  const pricerPut = await deploy("OptionsPremiumPricerETHPut", {
    from: deployer,
    contract: {
      abi: OptionsPremiumPricerInStables_ABI,
      bytecode: OptionsPremiumPricerInStables_BYTECODE,
    },
    args: [
      ETH_USDC_POOL[chainId],
      manualVolOracle.address,
      underlyingOracle,
      stablesOracle,
    ],
  });

  console.log([
    ETH_USDC_POOL[chainId],
    manualVolOracle.address,
    underlyingOracle,
    stablesOracle,
  ]);
  console.log(`OptionsPremiumPricerETHPut @ ${pricerPut.address}`);

  // Can't verify pricer because it's compiled with 0.7.3


  const strikeSelectionPut = await deploy("StrikeSelectionETHPut", {
    contract: "DeltaStrikeSelection",
    from: deployer,
    args: [pricerPut.address, STRIKE_DELTA, STRIKE_STEP[chainId]],
  });

  console.log(
    `StrikeSelectionETHPut @ ${strikeSelectionPut.address}`
  );

  try {
    await run("verify:verify", {
      address: strikeSelectionPut.address,
      constructorArguments: [
        pricerPut.address,
        STRIKE_DELTA,
        STRIKE_STEP[chainId],
      ],
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["ETHStrikeSelection"];
main.dependencies = ["ManualVolOracle"];

export default main;
