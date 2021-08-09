import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
  getDefaultSigner,
  Networks,
} from "../helpers/getDefaultEthersProvider";
import {
  WETH_ADDRESS,
  ManualVolOracle_BYTECODE,
  OptionsPremiumPricer_BYTECODE,
  MAINNET_USDC_ORACLE,
} from "../../constants/constants";
import OptionsPremiumPricer_ABI from "../../constants/abis/OptionsPremiumPricer.json";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";

const ETH_USDC_POOL = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
const MAINNET_ETH_ORACLE = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const RINKEBY_ETH_ORACLE = "0x8A753747A1Fa494EC906cE90E9f37563A8AF630e";

const STRIKE_STEP = 100;
const STRIKE_DELTA = 1000; // 0.1d

const deployThetaVault = async (hre: HardhatRuntimeEnvironment) => {
  console.log("Deploying ETH Theta Vault on", hre.network.name);

  const signer = getDefaultSigner({ network: hre.network.name as Networks });
  console.log("Deploying with", signer.address);

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

  // const optionsPremiumPricer = await OptionsPremiumPricer.deploy(
  //   ETH_USDC_POOL,
  //   volOracle.address,
  //   MAINNET_ETH_ORACLE,
  //   MAINNET_USDC_ORACLE
  // );

  // const strikeSelection = await StrikeSelection.deploy(
  //   optionsPremiumPricer.address,
  //   STRIKE_DELTA,
  //   STRIKE_STEP
  // );
};

export default deployThetaVault;
