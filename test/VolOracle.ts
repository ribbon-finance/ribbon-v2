import { ethers, network } from "hardhat";
import { describe, it } from "mocha";
import { increaseTo, getTopOfPeriod } from "./helpers/time";
import {
  BLOCK_NUMBER,
  CHAINID,
  ETH_USDC_POOL,
  TestVolOracle_BYTECODE,
  ManualVolOracle_BYTECODE,
} from "../constants/constants";
import TestVolOracle_ABI from "../constants/abis/TestVolOracle.json";
import ManualVolOracle_ABI from "../constants/abis/ManualVolOracle.json";
import { constants } from "ethers";

const { BigNumber, getContractFactory, getSigners } = ethers;

const PERIOD = 43200; // 12 hours
const chainId = network.config.chainId;

describe("TestVolOracle", () => {
  if (chainId !== CHAINID.ETH_MAINNET) return;

  let volOracle;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            chainId: CHAINID.ETH_MAINNET,
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: BLOCK_NUMBER[chainId],
          },
        },
      ],
    });

    const [signer] = await getSigners();

    const TestVolOracle = await getContractFactory(
      TestVolOracle_ABI,
      TestVolOracle_BYTECODE,
      signer
    );

    volOracle = await TestVolOracle.deploy(PERIOD, 7);

    await volOracle.initPool(ETH_USDC_POOL[chainId]);
  });

  it("Updates volatility", async () => {
    const updateVol = async (asset: string) => {
      const values = [
        BigNumber.from("2000000000"),
        BigNumber.from("2100000000"),
        BigNumber.from("2200000000"),
        BigNumber.from("2150000000"),
        BigNumber.from("2250000000"),
        BigNumber.from("2350000000"),
        BigNumber.from("2450000000"),
        BigNumber.from("2550000000"),
        BigNumber.from("2350000000"),
        BigNumber.from("2450000000"),
        BigNumber.from("2250000000"),
        BigNumber.from("2250000000"),
        BigNumber.from("2650000000"),
      ];

      for (let i = 0; i < values.length; i++) {
        await volOracle.setPrice(values[i]);
        const topOfPeriod = (await getTopOfPeriod()) + PERIOD;
        await increaseTo(topOfPeriod);
        await volOracle.mockCommit(asset);
      }
    };
    await updateVol(ETH_USDC_POOL[chainId]);
  });
});

describe("ManualVolOracle", () => {
  if (network.config.chainId !== CHAINID.ETH_MAINNET) return;

  let manualVolOracle;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            chainId: CHAINID.ETH_MAINNET,
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: BLOCK_NUMBER[chainId],
          },
        },
      ],
    });

    const [signer] = await getSigners();

    const ManualVolOracle = await getContractFactory(
      ManualVolOracle_ABI,
      ManualVolOracle_BYTECODE,
      signer
    );

    manualVolOracle = await ManualVolOracle.deploy(signer.address);
  });

  it("setAnnualizedVol", async () => {
    const annualizedVol = 106480000;

    const mockOptionId =
      constants.HashZero.slice(0, constants.HashZero.length - 1) + "1";

    await manualVolOracle.setAnnualizedVol([mockOptionId], [annualizedVol]);
  });
});
