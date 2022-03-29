import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { assert } from "../helpers/assertions";
import {
  BLOCK_NUMBER,
  CHAINID,
  SAVAX_ADDRESS,
  ETH_PRICE_ORACLE,
} from "../../constants/constants";

describe("SVAXOracle", () => {
  let wAvaxOracle: Contract;
  let sAvaxOracle: Contract;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.AVAX_URI,
            blockNumber: BLOCK_NUMBER[CHAINID.AVAX_MAINNET],
          },
        },
      ],
    });
    const SAvaxOracle = await ethers.getContractFactory("SAvaxOracle");
    sAvaxOracle = await SAvaxOracle.deploy(
      SAVAX_ADDRESS[CHAINID.AVAX_MAINNET],
      ETH_PRICE_ORACLE[CHAINID.AVAX_MAINNET] // Wrapped Avax
    );

    wAvaxOracle = await ethers.getContractAt(
      "AggregatorV3Interface",
      ETH_PRICE_ORACLE[CHAINID.AVAX_MAINNET]
    );
  });

  it("gets staked avax price", async () => {
    const sAvaxPrice = await sAvaxOracle.latestAnswer();
    assert.equal(sAvaxPrice.toString(), "7148436116");
  });

  it("checks staked avax trades at a premium above wrapped avax", async () => {
    const [, wAvaxPrice, , ,] = await wAvaxOracle.latestRoundData();
    const sAvaxPrice = await sAvaxOracle.latestAnswer();
    assert.isAbove(
      parseInt(sAvaxPrice.toString()),
      parseInt(wAvaxPrice.toString())
    );
  });

  it("checks staked avax has correct decimals", async () => {
    assert.equal(
      (await sAvaxOracle.decimals()).toString(),
      (await wAvaxOracle.decimals()).toString()
    );
  });
});
