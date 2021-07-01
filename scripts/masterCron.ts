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
import { GNOSIS_EASY_AUCTION, BYTES_ZERO } from "../test/helpers/constants";
import { hexStripZeros } from "ethers/lib/utils";
import { CronJob } from "cron";
import Discord = require("discord.js");

const program = new Command();
program.version("0.0.1");
program.option("-n, --network <network>", "Network", "mainnet");

program.parse(process.argv);

require("dotenv").config();

// 3600000 = 1hr
const TIMELOCK_PERIOD = 3600000;
// 0 10 * * 5 = 10am UTC on Fridays. https://crontab.guru/ is a friend
const CRON = "0 10 * * 5";

var client = new Discord.Client();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function log(msg: string) {
  (client.channels.cache.get(auth.channel_id) as Discord.TextChannel).send(msg);
}

async function waitForAuctionClose(
  auctionCounters: Array<number>,
  gnosisAuction: Contract
) {
  const auctionDetails = await gnosisAuction.auctionData(
    auctionCounters[auctionCounters.length - 1]
  );

  // Wait until the last initiated auction is finished
  await sleep(auctionDetails.auctionEndDate.sub(await time.now()).mul(1000));
}

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
      await log(`settleAuction (${auctionID}): ${tx.hash}`);
    } catch (error) {
      await log(
        `@everyone settleAuction (${auctionID}): failed with error ${error}`
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
  for (let vaultName in deployments[network]) {
    const vault = new ethers.Contract(
      deployments[network].vaultName,
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
      log(`${method} (${vaultName}): ${tx.hash}`);

      if (method === "rollToNextOption") {
        const receipt = await tx.wait();
        returnData.push(
          hexStripZeros(receipt["logs"][15]["topics"][1]).toString().slice(2)
        );
      }
    } catch (error) {
      await log(
        `@everyone ${method} (${vaultName}): failed with error ${error}`
      );
    }
  }

  return returnData;
}

async function main() {
  const network = program.network === "mainnet" ? "mainnet" : "kovan";
  const provider = getDefaultProvider(program.network);
  const signer = getDefaultSigner("m/44'/60'/0'/0/1", network).connect(
    provider
  );
  const vaultArtifact = await hre.artifacts.readArtifact("RibbonThetaVault");
  const gnosisArtifact = await hre.artifacts.readArtifact("IGnosisAuction");
  const gnosisAuction = new ethers.Contract(
    GNOSIS_EASY_AUCTION,
    gnosisArtifact.abi,
    provider
  );

  // Master Cron Job
  //
  // 1. commitAndClose
  await runTX(vaultArtifact.abi, provider, signer, network, "commitAndClose");
  // 2. wait an hour (timelock period)
  await sleep(TIMELOCK_PERIOD);
  // 3. rollToNextOption
  let auctionCounters = await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "rollToNextOption"
  );
  // 4. wait for auctions to close
  await waitForAuctionClose(auctionCounters, gnosisAuction);
  // 5. settleAuction
  await settleAuctions(
    gnosisAuction,
    provider,
    signer,
    network,
    auctionCounters
  );
  // 6. if otokens left to burn: burnRemainingOTokens
  await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    network,
    "burnRemainingOTokens"
  );
  // 7. wait approximately a week
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

  var job = new CronJob(
    CRON,
    async function () {
      await main();
    },
    null,
    true,
    "Atlantic/Reykjavik"
  );

  job.start();
}

run();
