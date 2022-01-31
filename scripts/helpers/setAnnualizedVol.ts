import ManualVolOracle_ABI from "../../constants/abis/ManualVolOracle.json";
import { ethers } from "hardhat";
const { getContractAt } = ethers;

const setAnnualizedVol = async (oracle: string, pool: string, vol: number) => {
  let keeperSigner = (await ethers.getSigners())[2];

  const oracleContract = await getContractAt(ManualVolOracle_ABI, oracle);

  await oracleContract.connect(keeperSigner).setAnnualizedVol(pool, vol);
  console.log((await oracleContract.annualizedVol(pool)).toString());
};

export default setAnnualizedVol;
