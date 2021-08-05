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

const wethPriceOracleAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const wbtcPriceOracleAddress = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const usdcPriceOracleAddress = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";

const steps = {
  [WETH_ADDRESS]: 100,
  [WBTC_ADDRESS]: 1000,
};

const deployThetaVault = async (
  args: {
    underlying: string;
  },
  hre: HardhatRuntimeEnvironment
) => {
  const underlying = args.underlying;

  console.log("Network", hre.network.name);

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

  const optionsPremiumPricer = await OptionsPremiumPricer.deploy(
    underlying === WETH_ADDRESS ? ethusdcPool : wbtcusdcPool,
    volOracle.address,
    underlying === WETH_ADDRESS
      ? wethPriceOracleAddress
      : wbtcPriceOracleAddress,
    usdcPriceOracleAddress
  );

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

  const VaultLifecycle = await hre.ethers.getContractFactory("VaultLifecycle");
  const vaultLifecycleLib = await VaultLifecycle.deploy();
};

export default deployThetaVault;
