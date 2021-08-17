import { Command } from "commander";
import hre from "hardhat";
import { ethers } from "ethers";
import { BigNumber, constants, Contract, Wallet } from "ethers";
import auth from "./auth.json";
import {
  getDefaultProvider,
  getDefaultSigner,
} from "./helpers/getDefaultEthersProvider";
import moment from "moment";
import deployments from "../constants/deployments-mainnet-cron.json";
import { gas } from "./helpers/getGasPrice";
import { wmul } from "../test/helpers/math";
import * as time from "../test/helpers/time";
import {
  GNOSIS_EASY_AUCTION,
  VOL_ORACLE,
  MANUAL_VOL_ORACLE,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  BYTES_ZERO,
} from "../constants/constants";
import { encodeOrder } from "../test/helpers/utils";
import OptionsPremiumPricer_ABI from "../constants/abis/OptionsPremiumPricer.json";

import { CronJob } from "cron";
import Discord = require("discord.js");

const program = new Command();
program.version("0.0.1");
program.option("-n, --network <network>", "Network", "mainnet");

program.parse(process.argv);

require("dotenv").config();

var client = new Discord.Client();

const network = program.network === "mainnet" ? "mainnet" : "kovan";
const provider = getDefaultProvider(program.network);
const signer = getDefaultSigner("m/44'/60'/0'/0/0", network).connect(provider);

let gasLimits = {
  volOracleCommit: 85000,
  volOracleAnnualizedVol: 50000,
  settleAuction: 200000,
  claimAuctionOtokens: 200000,
  commitAndClose: 1500000,
  rollToNextOption: 1500000,
  burnRemainingOTokens: 100000,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function log(msg: string) {
  (client.channels.cache.get(auth.channel_id) as Discord.TextChannel).send(msg);
}

const getTopOfPeriod = async (provider: any, period: number) => {
  const latestTimestamp = (await provider.getBlock("latest")).timestamp;
  let topOfPeriod = latestTimestamp - (latestTimestamp % period) + period;
  return topOfPeriod;
};

const decimalShift = async (collateralAsset: Contract) => {
  let decimals = await collateralAsset.decimals();
  return BigNumber.from(10).pow(BigNumber.from(18).sub(decimals));
};

const getNextFriday = (currentExpiry: number) => {
  const DAY = 86400;
  const HOUR = 3600;

  let dayOfWeek = (currentExpiry / DAY + 4) % 7;
  let nextFriday = currentExpiry + ((7 + 5 - dayOfWeek) % 7) * DAY;
  let friday8am = nextFriday - (nextFriday % (24 * HOUR)) + 8 * HOUR;

  // If the passed currentExpiry is day=Friday hour>8am, we simply increment it by a week to next Friday
  if (currentExpiry >= friday8am) {
    friday8am += 7 * DAY;
  }
  return friday8am;
};

async function getStrikePrice(
  vault: Contract,
  strikeSelection: Contract,
  ierc20ABI: any
) {
  let expiry;
  let currentOption = (await vault.optionState()).currentOption;
  if (currentOption == constants.AddressZero) {
    expiry = await getNextFriday((await provider.getBlock("latest")).timestamp);
  } else {
    expiry = await getNextFriday(
      (
        await new ethers.Contract(
          currentOption,
          ierc20ABI,
          provider
        ).expiryTimestamp()
      ).toNumber()
    );
  }

  let isPut = (await vault.vaultParams()).isPut;

  let strike = await strikeSelection.getStrikePrice(expiry, isPut);

  return [expiry, isPut, strike];
}

async function getOptionPremium(
  vault: Contract,
  optionsPremiumPricer: Contract,
  strikePrice: BigNumber,
  expiry: BigNumber,
  isPut: boolean
) {
  let premium = (
    await optionsPremiumPricer.getPremium(strikePrice, expiry, isPut)
  )
    .mul(await vault.premiumDiscount())
    .div(1000);

  return premium;
}

async function getAnnualizedVol(underlying: string, resolution: number) {
  const latestTimestamp = (await provider.getBlock("latest")).timestamp;

  const msg = {
    jsonrpc: "2.0",
    id: 833,
    method: "public/get_volatility_index_data",
    params: {
      currency: underlying,
      // resolution is in minutes, we multiply by 60 to get seconds
      start_timestamp: (latestTimestamp - resolution * 60).toString(),
      end_timestamp: latestTimestamp.toString(),
      resolution: resolution,
    },
  };
  const ws = new WebSocket("wss://www.deribit.com/ws/api/v2");
  ws.onmessage = function (e) {
    let candles = e.data;
    // indices for the timerange of the latest volatility value
    // https://docs.deribit.com/?javascript#public-get_volatility_index_data
    // open = 1, high = 2, low = 3, close = 4
    // scale to 10 ** 8
    return Math.floor(e.data[candles.length - 1][1] * 10 ** 8);
  };
  ws.onopen = function () {
    ws.send(JSON.stringify(msg));
  };
}

async function settleAuctionsAndClaim(
  gnosisAuction: Contract,
  vaultArtifactAbi: any,
  provider: any,
  signer: Wallet,
  network: string
) {
  for (let vaultName in deployments[network].vaults) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName],
      vaultArtifactAbi,
      provider
    );
    const auctionID = await vault.optionAuctionID();
    const auctionDetails = await gnosisAuction.auctionData(auctionID);
    // If initialAuctionOrder is bytes32(0) auction has
    // already been settled as gnosis does gas refunds
    if (auctionDetails.initialAuctionOrder === BYTES_ZERO) {
      continue;
    }
    let newGasPrice = (await gas(network)).toString();
    try {
      const tx = await gnosisAuction.connect(signer).settleAuction({
        gasPrice: newGasPrice,
        gasLimit: gasLimits["settleAuction"],
      });

      await log(`GnosisAuction-settleAuction()-${auctionID}: ${tx.hash}`);
    } catch (error) {
      await log(
        `@everyone GnosisAuction-settleAuction()-${auctionID}: failed with error ${error}`
      );
    }

    try {
      const tx = await gnosisAuction
        .connect(signer)
        .claimFromParticipantOrder(auctionID, [
          encodeOrder(await vault.auctionSellOrder()),
        ]);

      await log(
        `GnosisAuction-claimFromParticipantOrder()-${auctionID}: ${tx.hash}`
      );
    } catch (error) {
      await log(
        `@everyone GnosisAuction-claimFromParticipantOrder()-${auctionID}: failed with error ${error}`
      );
    }
  }
}

async function runTX(
  vaultArtifactAbi: any,
  provider: any,
  signer: Wallet,
  network: string,
  method: string
) {
  for (let vaultName in deployments[network].vaults) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName],
      vaultArtifactAbi,
      provider
    );

    // If current option is not zero address, means
    // someone already called new weeks rollToNextOption
    if (
      method === "rollToNextOption" &&
      (await vault.currentOption()) === constants.AddressZero
    ) {
      await log(`${method} (${vaultName}): skipped`);
      continue;
    }

    let newGasPrice = (await gas(network)).toString();

    try {
      const tx = await vault.connect(signer)[`${method}()`]({
        gasPrice: newGasPrice,
        gasLimit: gasLimits[method],
      });
      log(`ThetaVault-${method}()-${vaultName}: ${tx.hash}`);
    } catch (error) {
      await log(
        `@everyone ThetaVault-${method}()-${vaultName}: failed with error ${error}`
      );
    }
  }
}

async function strikeForecasting() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const gnosisArtifact = await hre.artifacts.readArtifact("GnosisAuction");
  const strikeSelectionArtifact = await hre.artifacts.readArtifact(
    "StrikeSelection"
  );
  const vaultLifecycleArtifact = await hre.artifacts.readArtifact(
    "VaultLifecycle"
  );
  const stethArtifact = await hre.artifacts.readArtifact("IWSTETH");
  const yearnArtifact = await hre.artifacts.readArtifact("IYearnVault");
  const ierc20Artifact = await hre.artifacts.readArtifact("IERC20");

  for (let vaultName in deployments[network].vaults) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName].address,
      vaultArtifact.abi,
      provider
    );

    const strikeSelection = new ethers.Contract(
      deployments[network].vaults[vaultName].strikeSelection,
      strikeSelectionArtifact.abi,
      provider
    );

    const optionsPremiumPricer = new ethers.Contract(
      deployments[network].vaults[vaultName].optionsPremiumPricer,
      OptionsPremiumPricer_ABI,
      provider
    );

    let [expiry, isPut, strike] = await getStrikePrice(
      vault,
      strikeSelection,
      ierc20Artifact
    );

    let optionPremium = await getOptionPremium(
      vault,
      optionsPremiumPricer,
      strike,
      expiry,
      isPut
    );

    // Adjust for yearn / steth
    if (vaultName.includes("yearn")) {
      const collateralToken = new ethers.Contract(
        await vault.collateralToken(),
        yearnArtifact.abi,
        provider
      );
      optionPremium = wmul(
        optionPremium,
        collateralToken.pricePerShare().mul(decimalShift(collateralToken))
      );
    } else if (vaultName.includes("steth")) {
      const collateralToken = new ethers.Contract(
        await vault.collateralToken(),
        stethArtifact.abi,
        provider
      );
      optionPremium = wmul(optionPremium, collateralToken.stEthPerToken());
    }

    await log(
      `Expected strike price for ${vaultName}: ${strike.toString()} \n Expected premium: ${optionPremium.toString()}`
    );
  }
}

async function commitAndClose() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");

  // 1. commitAndClose
  await runTX(vaultArtifact.abi, provider, signer, network, "commitAndClose");
}

async function rollToNextOption() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");

  // 2. rollToNextOption
  let auctionCounters = await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "rollToNextOption"
  );
}

async function settleAuctionAndClaim() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const gnosisArtifact = await hre.artifacts.readArtifact("IGnosisAuction");

  const gnosisAuction = new ethers.Contract(
    GNOSIS_EASY_AUCTION,
    gnosisArtifact.abi,
    provider
  );

  // 3. settleAuction and claim
  await settleAuctionsAndClaim(
    gnosisAuction,
    vaultArtifact,
    provider,
    signer,
    network
  );

  // 4. burnRemainingOTokens
  await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "burnRemainingOTokens"
  );
}

async function updateManualVol() {
  const volOracleArtifact = await hre.artifacts.readArtifact("VolOracle");

  const volOracle = new ethers.Contract(
    MANUAL_VOL_ORACLE,
    volOracleArtifact.abi,
    provider
  );

  // 1 min resolution
  let dvolBTC = await getAnnualizedVol("BTC", 1);
  let dvolETH = await getAnnualizedVol("ETH", 1);

  for (let univ3poolName in deployments[network].univ3pools) {
    let newGasPrice = (await gas(network)).toString();
    const tx = await volOracle
      .connect(signer)
      .setAnnualizedVol(
        deployments[network].univ3pools[univ3poolName],
        univ3poolName.includes("btc") ? dvolBTC : dvolETH,
        {
          gasPrice: newGasPrice,
          gasLimit: gasLimits["volOracleAnnualizedVol"],
        }
      );
    await log(`VolOracle-setAnnualizedVol()-(${univ3poolName}): ${tx.hash}`);
  }
}

async function updateVolatility() {
  const volOracleArtifact = await hre.artifacts.readArtifact("VolOracle");

  const volOracle = new ethers.Contract(
    VOL_ORACLE,
    volOracleArtifact.abi,
    provider
  );

  for (let univ3poolName in deployments[network].univ3pools) {
    let newGasPrice = (await gas(network)).toString();
    const tx = await volOracle
      .connect(signer)
      .commit(deployments[network].univ3pools[univ3poolName], {
        gasPrice: newGasPrice,
        gasLimit: gasLimits["volOracleCommit"],
      });
    await log(`VolOracle-commit()-(${univ3poolName}): ${tx.hash}`);
  }
}

async function run() {
  client.on("ready", () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setPresence({
      activity: {
        name: "vault status",
        type: "WATCHING",
      },
      status: "idle",
    });
  });

  client.login(process.env.DISCORD_TOKEN);

  //Atlantic/Reykjavik corresponds to UTC

  const STRIKE_FORECAST_HOURS_IN_ADVANCE = 1; // 1 hours in advance
  const COMMIT_START = 10; // 10 am UTC
  const VOL_PERIOD = 12 * 3600; // 12 hours
  const TIMELOCK_DELAY = 1; // 1 hour
  const AUCTION_LIFE_TIME_DELAY = 6; // 6 hours
  const AUCTION_SETTLE_BUFFER = 10; // 10 minutes

  var futureStrikeForecasting = new CronJob(
    // 0 0 9 * * 5 = 9am UTC on Fridays.
    `0 0 ${COMMIT_START - STRIKE_FORECAST_HOURS_IN_ADVANCE} * * 5`,
    async function () {
      await strikeForecasting();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  var commitAndCloseJob = new CronJob(
    // 0 0 10 * * 5 = 10am UTC on Fridays.
    `0 0 ${COMMIT_START} * * 5`,
    async function () {
      await updateManualVol();
      await commitAndClose();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  var rollToNextOptionJob = new CronJob(
    `0 0 ${COMMIT_START + TIMELOCK_DELAY} * * 5`,
    async function () {
      await rollToNextOption();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  var settleAuctionAndClaimJob = new CronJob(
    `0 ${AUCTION_SETTLE_BUFFER} ${
      COMMIT_START + TIMELOCK_DELAY + AUCTION_LIFE_TIME_DELAY
    } * * 5`,
    async function () {
      await settleAuctionAndClaim();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  const VOL_ORACLE_CRON = `0 0 */${BigNumber.from(VOL_PERIOD)
    .div(3600)
    .toString()} * * *`;
  const CLOSEST_VALID_TIME =
    1000 * (await getTopOfPeriod(provider, VOL_PERIOD));

  var updateVolatilityJob = new CronJob(
    new Date(CLOSEST_VALID_TIME),
    function () {
      var _ = new CronJob(
        VOL_ORACLE_CRON,
        async function () {
          await updateVolatility();
        },
        null,
        false,
        "Atlantic/Reykjavik"
      );

      _.start();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  await strikeForecasting();

  /*futureStrikeForecasting.start();
  commitAndCloseJob.start();
  rollToNextOptionJob.start();
  settleAuctionAndClaimJob.start()*/

  // Not commit()'ing for now
  // updateVolatilityJob.start();
}

run();
