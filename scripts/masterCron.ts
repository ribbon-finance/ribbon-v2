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
import deployments from "../constants/deployments.json";
import { gas } from "./helpers/getGasPrice";
import * as time from "../test/helpers/time";
import {
  GNOSIS_EASY_AUCTION,
  VOL_ORACLE,
  BYTES_ZERO,
} from "../test/helpers/constants";
import { hexStripZeros } from "ethers/lib/utils";
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
const signer = getDefaultSigner("m/44'/60'/0'/0/1", network).connect(provider);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function log(msg: string) {
  (client.channels.cache.get(auth.channel_id) as Discord.TextChannel).send(msg);
}

const getTopOfPeriod = async (provider: any, period: number) => {
  const latestTimestamp = (await provider.getBlock("latest")).timestamp;
  let topOfPeriod: number;

  const rem = latestTimestamp % period;
  if (rem < Math.floor(period / 2)) {
    topOfPeriod = latestTimestamp - rem + period;
  } else {
    topOfPeriod = latestTimestamp + rem + period;
  }
  return topOfPeriod;
};

async function settleAuctions(
  gnosisAuction: Contract,
  provider: any,
  signer: Wallet,
  network: string,
  auctionCounters: Array<number>
) {
  for (let auctionID in auctionCounters) {
    const auctionDetails = await gnosisAuction.auctionData(auctionID);
    // If initialAuctionOrder is bytes32(0) auction has
    // already been settled as gnosis does gas refunds
    if (auctionDetails.initialAuctionOrder === BYTES_ZERO) {
      continue;
    }
    let gasPrice = await gas(network);
    try {
      const tx = await gnosisAuction.connect(signer).settleAuction({
        gasPrice,
      });
      await log(`GnosisAuction-settleAuction()-${auctionID}: ${tx.hash}`);
    } catch (error) {
      await log(
        `@everyone GnosisAuction-settleAuction()-${auctionID}: failed with error ${error}`
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
  let returnData = [];
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

    let gasPrice = await gas(network);

    try {
      const tx = await vault.connect(signer)[`${method}()`]({
        gasPrice,
      });
      log(`ThetaVault-${method}()-${vaultName}: ${tx.hash}`);

      if (method === "commitAndClose") {
        returnData[0] = (await vault.delay()).div(3600);
      } else if (method === "rollToNextOption") {
        const receipt = await tx.wait();
        returnData.push(
          hexStripZeros(receipt["logs"][15]["topics"][1]).toString().slice(2)
        );
      }
    } catch (error) {
      await log(
        `@everyone ThetaVault-${method}()-${vaultName}: failed with error ${error}`
      );
    }
  }

  return returnData;
}

async function commitAndClose() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");

  // 1. commitAndClose
  let delayBeforeRoll = await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "commitAndClose"
  );

  return delayBeforeRoll[0];
}

async function rollToNextOption() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const gnosisArtifact = await hre.artifacts.readArtifact("IGnosisAuction");

  // 3. rollToNextOption
  let auctionCounters = await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "rollToNextOption"
  );

  const gnosisAuction = new ethers.Contract(
    GNOSIS_EASY_AUCTION,
    gnosisArtifact.abi,
    provider
  );

  const auctionDetails = await gnosisAuction.auctionData(
    auctionCounters[auctionCounters.length - 1]
  );

  // Wait until the last initiated auction is finished
  return [
    auctionDetails.auctionEndDate.sub(await time.now()).div(3600) + 1,
    auctionCounters,
  ];
}

async function settleAuction(auctionCounters: Array<number>) {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const gnosisArtifact = await hre.artifacts.readArtifact("IGnosisAuction");

  const gnosisAuction = new ethers.Contract(
    GNOSIS_EASY_AUCTION,
    gnosisArtifact.abi,
    provider
  );

  await settleAuctions(
    gnosisAuction,
    provider,
    signer,
    network,
    auctionCounters
  );

  await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "burnRemainingOTokens"
  );
}

async function updateVolatility() {
  const volOracleArtifact = await hre.artifacts.readArtifact("VolOracle");

  const volOracle = new ethers.Contract(
    VOL_ORACLE,
    volOracleArtifact.abi,
    provider
  );

  for (let univ3poolName in deployments[network].univ3pools) {
    let gasPrice = await gas(network);
    const tx = await volOracle
      .connect(signer)
      .commit(deployments[network].univ3pools[univ3poolName], { gasPrice });
    await log(`VolOracle-commit()-(${univ3poolName}): ${tx.hash}`);
  }
}

function run() {
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
  let timelockDelay: number;

  var commitAndCloseJob = new CronJob(
    // 0 0 10 * * 5 = 10am UTC on Fridays.
    `0 0 ${COMMIT_START} * * 5`,
    async function () {
      timelockDelay = await commitAndClose();
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  let auctionLifetimeDelay: number;
  let auctionCounters: Array<number>;

  var rollToNextOptionJob = new CronJob(
    `0 0 ${COMMIT_START + delay} * * 5`,
    async function () {
      [auctionLifetimeDelay, auctionCounters] = await rollToNextOption();
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  var settleAuctionJob = new CronJob(
    `0 0 ${COMMIT_START + delay + auctionLifetimeDelay} * * 5`,
    async function () {
      await settleAuction(auctionCounters);
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  const VOL_ORACLE_CRON = `* * */${(await volOracle.period())
    .div(3600)
    .toString()} * * *`;
  const CLOSEST_VALID_TIME =
    (await getTopOfPeriod(provider, await volOracle.period())) * 1000;

  var updateVolatilityJob = new CronJob(
    new Date(CLOSEST_VALID_TIME),
    function () {
      var _ = new CronJob(
        VOL_ORACLE_CRON,
        async function () {
          await updateVolatility();
        },
        null,
        true,
        "Atlantic/Reykjavik"
      );

      _.start();
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  commitAndCloseJob.start();
  rollToNextOptionJob.start();
  settleAuctionJob.start();
  updateVolatilityJob.start();
}

run();
