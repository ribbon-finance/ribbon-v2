import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ManualVolOracle_BYTECODE } from "../../constants/constants";
import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";
import { ethers, network } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
const {getContractAt} = ethers;

const setAnnualizedVol = async (
  oracle: string, pool: string, vol: number) => {

  let keeperSigner: SignerWithAddress

  [, , keeperSigner, , ] =
    await ethers.getSigners();

  const oracleContract = await getContractAt(
    ManualVolOracle_ABI,
    oracle
  );

  await oracleContract.connect(keeperSigner).setAnnualizedVol(pool, vol);
  console.log((await oracleContract.annualizedVol(pool)).toString())
};

export default setAnnualizedVol;
