import hre from "hardhat";
import { ethers, BigNumber, constants, Contract, Wallet } from "ethers";
import { Provider } from "@ethersproject/providers";
import { Command } from "commander";
import auth from "./auth.json";
import {
  getDefaultProvider,
  getDefaultSigner,
} from "./helpers/getDefaultEthersProvider";
import moment from "moment";
import got from "got";
import deployments from "../constants/deployments-mainnet-cron.json";
import { gas } from "./helpers/getGasPrice";
import { wmul } from "../test/helpers/math";
import * as fs from "fs";
import simpleGit, { SimpleGit, SimpleGitOptions } from "simple-git";
import {
  GNOSIS_EASY_AUCTION,
  VOL_ORACLE,
  MANUAL_VOL_ORACLE,
  BYTES_ZERO,
} from "../constants/constants";
import { encodeOrder } from "../test/helpers/utils";
import OptionsPremiumPricer_ABI from "../constants/abis/OptionsPremiumPricer.json";
import ManualVolOracle_ABI from "../constants/abis/ManualVolOracle.json";

import { CronJob } from "cron";
import Discord = require("discord.js");

const { formatUnits } = ethers.utils;

const program = new Command();
program.version("0.0.1");
program.option("-n, --network <network>", "Network", "mainnet");

program.parse(process.argv);

require("dotenv").config();

const client = new Discord.Client();

const network = program.network === "mainnet" ? "mainnet" : "kovan";
const provider = getDefaultProvider(program.network);
const signer = getDefaultSigner("m/44'/60'/0'/0/0", network).connect(provider);
const auctionParticipantTag = "<@&893435203144544316>";

const HOUR = 3600;
const DAY = 24 * HOUR;
const TX_SLEEP_TIME = 300000; // 5 minutes

let gasLimits = {
  volOracleCommit: 85000,
  volOracleAnnualizedVol: 50000,
  settleAuction: 200000,
  claimAuctionOtokens: 200000,
  commitAndClose: 1500000,
  rollToNextOption: 1500000,
  burnRemainingOTokens: 100000,
};

interface Version {
  major: number;
  minor: number;
  patch: number;
}

interface OToken {
  logoURI: string;
  chainId: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
}

interface TokenSet {
  name: string;
  keywords: Array<string>;
  timestamp: string;
  version: Version;
  tokens: Array<OToken>;
}

const sleep = async (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms)); // eslint-disable-line no-promise-executor-return

async function log(msg: string) {
  if (msg.length >= 2000) {
    console.log("EXCEEDED LENGTH");
    console.log(msg);
  }
  (client.channels.cache.get(auth.channel_id) as Discord.TextChannel).send(msg);
}

const getTopOfPeriod = async (provider: Provider, period: number) => {
  const latestTimestamp = (await provider.getBlock("latest")).timestamp;
  let topOfPeriod = latestTimestamp - (latestTimestamp % period) + period;
  return topOfPeriod;
};

const decimalShift = async (collateralAsset: Contract) => {
  let decimals = await collateralAsset.decimals();
  return BigNumber.from(10).pow(BigNumber.from(18).sub(decimals));
};

const getNextFriday = (currentExpiry: number) => {
  let dayOfWeek = (currentExpiry / DAY + 4) % 7;
  let nextFriday = currentExpiry + ((7 + 5 - dayOfWeek) % 7) * DAY;
  let friday8am = nextFriday - (nextFriday % (24 * HOUR)) + 8 * HOUR;

  // If the passed currentExpiry is day=Friday hour>8am, we simply increment it by a week to next Friday
  if (currentExpiry >= friday8am) {
    friday8am += 7 * DAY;
  }
  return friday8am;
};

function generateTokenSet(tokens: Array<OToken>) {
  // reference: https://github.com/opynfinance/opyn-tokenlist/blob/master/opyn-v1.tokenlist.json
  const tokenJSON: TokenSet = {
    name: "Ribbon oTokens",
    keywords: ["defi", "option", "opyn", "ribbon"],
    //convert to something like 2021-09-08T10:51:49Z
    timestamp: moment().format().toString().slice(0, -6) + "Z",
    version: { major: 1, minor: 0, patch: 0 },
    tokens,
  };

  return tokenJSON;
}

async function pushTokenListToGit(tokenSet: TokenSet, fileName: string) {
  const options: Partial<SimpleGitOptions> = {
    baseDir: process.cwd(),
    binary: "git",
    maxConcurrentProcesses: 6,
  };

  // when setting all options in a single object
  const git: SimpleGit = simpleGit(options);
  const filePath = `/home/ribbon-token-list/${fileName}`;

  let newTokenSet = tokenSet;

  let currentTokenSet = (
    JSON.parse(
      fs.readFileSync(filePath, { encoding: "utf8", flag: "r" })
    ) as TokenSet
  ).tokens;

  // add new week's otokens to token list
  newTokenSet.tokens = currentTokenSet.concat(newTokenSet.tokens);
  //remove duplicates
  newTokenSet.tokens = [
    ...new Map(newTokenSet.tokens.map((item) => [item.address, item])).values(),
  ];

  await fs.writeFileSync(filePath, JSON.stringify(newTokenSet, null, 2), {
    encoding: "utf8",
    flag: "w",
  });

  await git
    .cwd("/home/ribbon-token-list")
    .addConfig("user.name", "cron job")
    .addConfig("user.email", "some@one.com")
    .add(filePath)
    .commit(`update tokenset ${newTokenSet.timestamp}`)
    .push("origin", "main");
}

async function getDeribitDelta(instrumentName: string) {
  // https://docs.deribit.com/?javascript#public-get_mark_price_history
  const request = `https://www.deribit.com/api/v2/public/get_order_book?depth=1&instrument_name=${instrumentName}`;
  const response = await got(request);
  const delta = JSON.parse(response.body).result.greeks.delta;
  return delta;
}

async function getDeribitStrikePrice(
  strikeSelection: Contract,
  optionsPremiumPricer: Contract,
  underlying: string,
  isPut: boolean,
  expiry: number
) {
  let delta = await strikeSelection.delta();
  let spotPrice = parseInt(
    (await optionsPremiumPricer.getUnderlyingPrice())
      .div(BigNumber.from(10).pow(8))
      .toString()
  );

  // in milliseconds
  let expiryMargin = 3 * HOUR * 1000;

  // https://docs.deribit.com/?shell#public-get_instrument
  var request = `https://www.deribit.com/api/v2/public/get_instruments?currency=${underlying}&expired=false&kind=option`;
  const response = await got(request);

  let instruments = JSON.parse(response.body).result;

  var bestStrike = 0;
  var bestDelta = 1000000;
  var bestDeltaDiff = 1000000;

  for (const instrument of instruments) {
    let intrumentName = instrument.instrument_name;
    // If the expiry is the same expiry as our option and is same type (put / call)
    let sameOptionType = isPut === (instrument.option_type === "put");
    let sameExpiry =
      Math.abs(expiry * 1000 - instrument.expiration_timestamp) < expiryMargin;
    let isOTM = instrument.strike > spotPrice;
    if (sameOptionType && sameExpiry && isOTM) {
      let currDelta = await getDeribitDelta(intrumentName);
      let currDiff = Math.abs(currDelta * 10000 - delta);
      // If the delta of the current instrument is closest to 0.1d
      // so far we update the best strike
      if (currDiff < bestDeltaDiff) {
        bestDeltaDiff = currDiff;
        bestDelta = currDelta;
        bestStrike = instrument.strike;
      }
    }
  }

  return [bestStrike, bestDelta];
}

async function getStrikePrice(
  vault: Contract,
  strikeSelection: Contract,
  iOtokenABI: any // eslint-disable-line @typescript-eslint/no-explicit-any
) {
  let expiry;
  let currentOption = (await vault.optionState()).currentOption;
  if (currentOption === constants.AddressZero) {
    expiry = await getNextFriday((await provider.getBlock("latest")).timestamp);
  } else {
    expiry = await getNextFriday(
      parseInt(
        (
          await new ethers.Contract(
            currentOption,
            iOtokenABI,
            provider
          ).expiryTimestamp()
        ).toString()
      )
    );
  }

  let isPut = (await vault.vaultParams()).isPut;

  let [strike, delta] = await strikeSelection.getStrikePrice(expiry, isPut);

  return [delta, strike, expiry, isPut];
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
  // in milliseconds
  const latestTimestamp = (await provider.getBlock("latest")).timestamp * 1000;

  let startTimestamp = (latestTimestamp - resolution * 1000).toString();
  let endTimestamp = latestTimestamp.toString();

  // https://docs.deribit.com/?javascript#public-get_volatility_index_data
  const request = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${underlying}&end_timestamp=${endTimestamp}&resolution=${resolution}&start_timestamp=${startTimestamp}`;
  const response = await got(request);

  let candles = JSON.parse(response.body).result.data;
  // indices for the timerange of the latest volatility value
  // open = 1, high = 2, low = 3, close = 4
  let pricePoint = 4;
  // scale to 10 ** 6
  return candles[candles.length - 1][pricePoint] * 10 ** 6;
}

async function updateTokenList(
  fileName: string,
  vaultArtifactAbi: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ierc20Abi: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  provider: Provider,
  network: string
) {
  let tokens = [];

  for (
    let vaultName = 0;
    vaultName < deployments[network].vaults.length;
    vaultName++
  ) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName].address,
      vaultArtifactAbi,
      provider
    );

    let oToken = new ethers.Contract(
      await vault.nextOption(),
      ierc20Abi,
      provider
    );

    let name = (await oToken.name()).split(" ");
    name.pop();
    name.pop();

    const token: OToken = {
      logoURI: "https://i.imgur.com/u5z1Ev2.png",
      chainId: 1,
      address: oToken.address,
      name: name.join(" "),
      symbol: (await oToken.symbol()).split("/")[1],
      decimals: parseInt((await oToken.decimals()).toString()),
    };
    tokens.push(token);
  }

  await pushTokenListToGit(generateTokenSet(tokens), fileName);
}

async function settleAndBurn(
  gnosisAuction: Contract,
  vaultArtifactAbi: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ierc20Abi: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  provider: Provider,
  signer: Wallet,
  network: string
) {
  for (
    let vaultName = 0;
    vaultName < deployments[network].vaults.length;
    vaultName++
  ) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName].address,
      vaultArtifactAbi,
      provider
    );
    const auctionID = await vault.optionAuctionID();
    const auctionDetails = await gnosisAuction.auctionData(auctionID);

    try {
      // If initialAuctionOrder is bytes32(0) auction has
      // already been settled as gnosis does gas refunds
      if (auctionDetails.initialAuctionOrder !== BYTES_ZERO) {
        let newGasPrice = (await gas(network)).toString();

        const tx = await gnosisAuction
          .connect(signer)
          .settleAuction(auctionID.toString(), {
            gasPrice: newGasPrice,
            gasLimit: gasLimits.settleAuction,
          });

        await tx.wait();

        await log(
          `GnosisAuction-settleAuction()-${auctionID}: ${tx.transactionHash}`
        );
      }

      let oTokenBalance = await new ethers.Contract(
        await vault.currentOption(),
        ierc20Abi,
        provider
      ).balanceOf(vault.address);

      if (parseInt(oTokenBalance.toString()) === 0) {
        continue; // eslint-disable-line no-continue
      }

      let newGasPrice2 = (await gas(network)).toString();

      const tx2 = await vault.connect(signer).burnRemainingOTokens({
        gasPrice: newGasPrice2,
        gasLimit: gasLimits.burnRemainingOTokens,
      });

      await log(`GnosisAuction-burnRemainingOTokens(): ${tx2.hash}`);
    } catch (error) {
      await log(
        `GnosisAuction-settleAuction()-${auctionID}: failed with error ${error}`
      );
    }
  }
}

// eslint-disable-next-line no-unused-vars
async function claimFromParticipantOrder(
  gnosisAuction: Contract,
  vaultArtifactAbi: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  provider: Provider,
  signer: Wallet,
  network: string
) {
  for (
    let vaultName = 0;
    vaultName < deployments[network].vaults.length;
    vaultName++
  ) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName].address,
      vaultArtifactAbi,
      provider
    );

    const thetaVault = new ethers.Contract(
      await vault.counterpartyThetaVault(),
      vaultArtifactAbi,
      provider
    );

    const auctionID = await thetaVault.optionAuctionID();

    try {
      let newGasPrice = (await gas(network)).toString();

      const tx = await gnosisAuction
        .connect(signer)
        .claimFromParticipantOrder(
          auctionID,
          [encodeOrder(await vault.auctionSellOrder())],
          { gasPrice: newGasPrice, gasLimit: gasLimits.claimAuctionOtokens }
        );

      await log(
        `GnosisAuction-claimFromParticipantOrder()-${auctionID}: <https://etherscan.io/tx/${tx.hash}>`
      );
    } catch (error) {
      await log(
        `GnosisAuction-claimFromParticipantOrder()-${auctionID}: failed with error ${error}`
      );
    }
  }
}

async function runTX(
  vaultArtifactAbi: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  provider: Provider,
  signer: Wallet,
  network: string,
  method: string
) {
  for (
    let vaultName = 0;
    vaultName < deployments[network].vaults.length;
    vaultName++
  ) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName].address,
      vaultArtifactAbi,
      provider
    );

    // If current option is not zero address, means
    // someone already called new weeks rollToNextOption
    if (
      method === "rollToNextOption" &&
      (await vault.currentOption()) !== constants.AddressZero
    ) {
      await log(`${method} (${vaultName}): skipped`);
      continue; // eslint-disable-line no-continue
    }

    let newGasPrice = (await gas(network)).toString();

    try {
      const tx = await vault.connect(signer)[`${method}()`]({
        gasPrice: newGasPrice,
        gasLimit: gasLimits[method],
      });
      log(
        `ThetaVault-${method}()-${vaultName}: <https://etherscan.io/tx/${tx.hash}>`
      );
      await tx.wait();
    } catch (error) {
      await log(
        `ThetaVault-${method}()-${vaultName}: failed with error ${error}`
      );
    }
  }
}

async function strikeForecasting() {
  console.log("Forecasting strikes");

  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const strikeSelectionArtifact = await hre.artifacts.readArtifact(
    "StrikeSelection"
  );
  const stethArtifact = await hre.artifacts.readArtifact("IWSTETH");
  const yearnArtifact = await hre.artifacts.readArtifact("IYearnVault");
  const iOtokenArtifact = await hre.artifacts.readArtifact("IOtoken");
  const ierc20Artifact = await hre.artifacts.readArtifact(
    "contracts/interfaces/IERC20Detailed.sol:IERC20Detailed"
  );

  for (
    let vaultName = 0;
    vaultName < deployments[network].vaults.length;
    vaultName++
  ) {
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

    const asset = new ethers.Contract(
      (await vault.vaultParams()).asset,
      ierc20Artifact.abi,
      provider
    );

    let [delta, strike, expiry, isPut] = await getStrikePrice(
      vault,
      strikeSelection,
      iOtokenArtifact.abi
    );

    let [deribitStrike, deribitDelta] = await getDeribitStrikePrice(
      strikeSelection,
      optionsPremiumPricer,
      vaultName.includes("BTC") ? "BTC" : "ETH",
      isPut,
      expiry
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
      `${vaultName}\nExpected strike price: $${strike.div(
        BigNumber.from(10).pow(8)
      )} (${(delta / 10000).toFixed(
        4
      )} delta) \nDeribit strike price: $${deribitStrike} (${deribitDelta} delta) \nExpected premium: ${(
        optionPremium /
        10 ** 18
      ).toFixed(8)} ${await asset.symbol()} \nExpected expiry: ${new Date(
        expiry * 1000
      ).toUTCString()}`
    );
  }
}

async function commitAndClose() {
  console.log("Calling commitAndClose");

  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const otokenArtifact = await hre.artifacts.readArtifact("IOtoken");

  // 1. commitAndClose
  await runTX(vaultArtifact.abi, provider, signer, network, "commitAndClose");

  await sleep(TX_SLEEP_TIME);

  let msg = `${auctionParticipantTag} Strike prices have been selected. Auction begins at 11.15am UTC\n\n`;

  for (
    let vaultName = 0;
    vaultName < deployments[network].vaults.length;
    vaultName++
  ) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName].address,
      vaultArtifact.abi,
      provider
    );
    const { nextOption } = await vault.optionState();
    const otoken = new ethers.Contract(
      nextOption,
      otokenArtifact.abi,
      provider
    );
    const strikePriceStr = parseInt(formatUnits(await otoken.strikePrice(), 8));
    const dateStr = new Date(
      (await otoken.expiryTimestamp()).toNumber() * 1000
    );
    msg += `Strike price for ${vaultName}
Strike Price: ${strikePriceStr.toLocaleString()}
Expiry: ${dateStr.toUTCString()}\n\n`;
  }

  await log(msg);
}

async function rollToNextOption() {
  console.log("Calling rollToNextOption");

  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const ierc20Artifact = await hre.artifacts.readArtifact(
    "contracts/interfaces/IERC20Detailed.sol:IERC20Detailed"
  );

  // 2. updateTokenList
  await updateTokenList(
    "ribbon.tokenlist.json",
    vaultArtifact.abi,
    ierc20Artifact.abi,
    provider,
    network
  );

  // 3. rollToNextOption
  await runTX(vaultArtifact.abi, provider, signer, network, "rollToNextOption");

  await sleep(TX_SLEEP_TIME);

  let msg = `Auctions have begun. Happy bidding!\n\n`;

  for (
    let vaultName = 0;
    vaultName < deployments[network].vaults.length;
    vaultName++
  ) {
    const vault = new ethers.Contract(
      deployments[network].vaults[vaultName].address,
      vaultArtifact.abi,
      provider
    );
    const optionAuctionID = parseInt(
      (await vault.optionAuctionID()).toString()
    );
    msg += `Auction for ${vaultName}: <https://gnosis-auction.eth.link/#/auction?auctionId=${optionAuctionID}&chainId=1>\n`;
  }

  await log(msg);
}

async function settleAuctions() {
  console.log("Calling settleAuctions");

  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const gnosisArtifact = await hre.artifacts.readArtifact("IGnosisAuction");
  const ierc20Artifact = await hre.artifacts.readArtifact(
    "contracts/interfaces/IERC20Detailed.sol:IERC20Detailed"
  );

  const gnosisAuction = new ethers.Contract(
    GNOSIS_EASY_AUCTION,
    gnosisArtifact.abi,
    provider
  );

  // 4. settleAuction and 5. burnRemainingOTokens
  await settleAndBurn(
    gnosisAuction,
    vaultArtifact.abi,
    ierc20Artifact.abi,
    provider,
    signer,
    network
  );
}

async function updateManualVol() {
  console.log("Updating ManualVolOracle");

  const volOracle = new ethers.Contract(
    MANUAL_VOL_ORACLE["1"],
    ManualVolOracle_ABI,
    provider
  );

  // 1 second resolution
  let dvolBTC = await getAnnualizedVol("BTC", 1);
  let dvolETH = await getAnnualizedVol("ETH", 1);

  for (
    let univ3poolName = 0;
    univ3poolName < deployments[network].univ3pools.length;
    univ3poolName++
  ) {
    let newGasPrice = (await gas(network)).toString();
    const tx = await volOracle
      .connect(signer)
      .setAnnualizedVol(
        deployments[network].univ3pools[univ3poolName],
        univ3poolName.includes("btc") ? dvolBTC : dvolETH,
        {
          gasPrice: newGasPrice,
          gasLimit: gasLimits.volOracleAnnualizedVol,
        }
      );
    await log(
      `VolOracle-setAnnualizedVol()-(${univ3poolName}): <https://etherscan.io/tx/${tx.hash}>`
    );
  }
}

async function updateVolatility() {
  const volOracleArtifact = await hre.artifacts.readArtifact("VolOracle");

  const volOracle = new ethers.Contract(
    VOL_ORACLE,
    volOracleArtifact.abi,
    provider
  );

  for (
    let univ3poolName = 0;
    univ3poolName < deployments[network].univ3pools.length;
    univ3poolName++
  ) {
    let newGasPrice = (await gas(network)).toString();
    const tx = await volOracle
      .connect(signer)
      .commit(deployments[network].univ3pools[univ3poolName], {
        gasPrice: newGasPrice,
        gasLimit: gasLimits.volOracleCommit,
      });
    await log(
      `VolOracle-commit()-(${univ3poolName}): <https://etherscan.io/tx/${tx.hash}>`
    );
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
  const COMMIT_START = 10; // 10 am UTC
  const COMMIT_AND_CLOSE_MINUTE_SHIFT = 45; // 45 minutes
  const NETWORK_CONGESTION_BUFFER = 5; // 5 minutes
  const STRIKE_FORECAST_HOURS_IN_ADVANCE = 1; // 1 hours in advance
  const AUCTION_LIFE_TIME_DELAY = 1; // 1 hours
  const VOL_PERIOD = 12 * 3600; // 12 hours

  const futureStrikeForecasting = new CronJob(
    // 0 0 9 * * 5 = 9:45am UTC on Fridays.
    `0 ${COMMIT_AND_CLOSE_MINUTE_SHIFT} ${
      COMMIT_START - STRIKE_FORECAST_HOURS_IN_ADVANCE
    } * * 5`,
    async function () {
      await log(
        `\n=============================================================================`
      );
      await updateManualVol();
      await strikeForecasting();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  const commitAndCloseJob = new CronJob(
    // 0 45 10 * * 5 = 10:45am UTC on Fridays.
    `0 ${COMMIT_AND_CLOSE_MINUTE_SHIFT} ${COMMIT_START} * * 5`,
    async function () {
      await commitAndClose();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  const rollToNextOptionJob = new CronJob(
    `0 ${NETWORK_CONGESTION_BUFFER} ${COMMIT_START + 1} * * 5`,
    async function () {
      await rollToNextOption();
    },
    null,
    false,
    "Atlantic/Reykjavik"
  );

  let settleAuctionJob = new CronJob(
    `0 ${NETWORK_CONGESTION_BUFFER} ${
      COMMIT_START + AUCTION_LIFE_TIME_DELAY + 1
    } * * 5`,
    async function () {
      await settleAuctions();
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

  CronJob(
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

  futureStrikeForecasting.start();
  commitAndCloseJob.start();
  rollToNextOptionJob.start();
  settleAuctionJob.start();

  // Not commit()'ing for now
  // updateVolatilityJob.start();
}

run();
