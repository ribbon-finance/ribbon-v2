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

let auctionIDs: Array<number>;

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

      if (method === "rollToNextOption") {
        const receipt = await tx.wait();
        auctionIDs.push(
          parseInt(
            hexStripZeros(receipt["logs"][15]["topics"][1]).toString().slice(2)
          )
        );
      }
    } catch (error) {
      await log(
        `@everyone ThetaVault-${method}()-${vaultName}: failed with error ${error}`
      );
    }
  }
}

async function commitAndClose() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");

  // 1. commitAndClose
  await runTX(vaultArtifact.abi, provider, signer, network, "commitAndClose");
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
}

async function settleAuction() {
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const gnosisArtifact = await hre.artifacts.readArtifact("IGnosisAuction");

  const gnosisAuction = new ethers.Contract(
    GNOSIS_EASY_AUCTION,
    gnosisArtifact.abi,
    provider
  );

  await settleAuctions(gnosisAuction, provider, signer, network, auctionIDs);

  await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "burnRemainingOTokens"
  );

  auctionIDs = [];
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
  const VOL_PERIOD = 12 * 3600; // 12 hours
  const TIMELOCK_DELAY = 1; // 1 hour
  const AUCTION_LIFE_TIME_DELAY = 6; // 6 hours
  const AUCTION_SETTLE_BUFFER = 10; // 10 minutes

  var commitAndCloseJob = new CronJob(
    // 0 0 10 * * 5 = 10am UTC on Fridays.
    `0 0 ${COMMIT_START} * * 5`,
    async function () {
      await commitAndClose();
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  var rollToNextOptionJob = new CronJob(
    `0 0 ${COMMIT_START + TIMELOCK_DELAY} * * 5`,
    async function () {
      await rollToNextOption();
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  var settleAuctionJob = new CronJob(
    `0 ${AUCTION_SETTLE_BUFFER} ${
      COMMIT_START + TIMELOCK_DELAY + AUCTION_LIFE_TIME_DELAY
    } * * 5`,
    async function () {
      await settleAuction();
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  const VOL_ORACLE_CRON = `* * */${BigNumber.from(VOL_PERIOD)
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
          console.log("hello");
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
