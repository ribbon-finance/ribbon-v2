import hre from "hardhat";
import {
  getDefaultSigner,
  Networks,
} from "../helpers/getDefaultEthersProvider";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";
import {
  WETH_ADDRESS,
  WBTC_ADDRESS,
  ManualVolOracle_BYTECODE,
  OptionsPremiumPricer_BYTECODE,
} from "../../test/helpers/constants";
import { HardhatRuntimeEnvironment } from "hardhat/types";

require("dotenv").config();

const ethusdcPool = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
const wbtcusdcPool = "0x99ac8ca7087fa4a2a1fb6357269965a2014abc35";

const steps = {
  [WETH_ADDRESS]: 100,
  [WBTC_ADDRESS]: 1000,
};

const oracles = {
  wbtc: {
    mainnet: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
    rinkeby: "0xECe365B379E1dD183B20fc5f022230C044d51404",
  },
  weth: {
    mainnet: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    rinkeby: "0x8A753747A1Fa494EC906cE90E9f37563A8AF630e",
  },
  usdc: {
    mainnet: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
    rinkeby: "0xa24de01df22b63d23Ebc1882a5E3d4ec0d907bFB",
  },
};

const deployThetaVault = async (
  args: {
    underlying: string;
  },
  hre: HardhatRuntimeEnvironment
) => {
  const underlying = args.underlying;
  const network = hre.network.name;

  console.log("Network", network);

  const signer = getDefaultSigner(
    "m/44'/60'/0'/0/0",
    hre.network.name as Networks
  );
  console.log("Deploying with", signer.address);

  await hre.run("compile");

  const StrikeSelection = await hre.ethers.getContractFactory(
    "StrikeSelection",
    signer
  );
  const ManualVolOracle = await hre.ethers.getContractFactory(
    ManualVolOracle_ABI,
    ManualVolOracle_BYTECODE,
    signer
  );
  const OptionsPremiumPricer = await hre.ethers.getContractFactory(
    OptionsPremiumPricer_ABI,
    OptionsPremiumPricer_BYTECODE,
    signer
  );

  const volOracle = await ManualVolOracle.deploy(signer.address);

  // const volOracle = "0xDbF77e2D8d874224f4567310A8D97151e6CB25c9";

  const underlyingOracle =
    oracles[underlying === WETH_ADDRESS ? "weth" : "wbtc"][network];
  const pool = underlying === WETH_ADDRESS ? ethusdcPool : wbtcusdcPool;

  const optionsPremiumPricer = await OptionsPremiumPricer.deploy(
    pool,
    volOracle.address,
    underlyingOracle,
    oracles.usdc[network]
  );
  // const optionsPremiumPricer = "0xE8e1Df4F53c74853A2591222f557e655D484aDF2";

  if (!steps[underlying]) {
    throw new Error("No step set ");
  }
  const strikeStep = steps[underlying];
  const delta = 1000; // 0.1d

  const strikeSelection = await StrikeSelection.deploy(
    optionsPremiumPricer.address,
    delta,
    strikeStep
  );

  // const VaultLifecycle = await hre.ethers.getContractFactory("VaultLifecycle");
  // const vaultLifecycleLib = await VaultLifecycle.deploy();
};

export default deployThetaVault;
