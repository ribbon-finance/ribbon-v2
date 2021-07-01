import { Command } from "commander";
import { BigNumber, ethers } from "ethers";
import {
  getDefaultProvider,
  getDefaultSigner,
} from "./helpers/getDefaultEthersProvider";
import hre from "hardhat";
import moment from "moment";
import deployments from "../constants/deployments.json";
import { gas } from "./helpers/getGasPrice";
import * as time from "../test/helpers/time";
import { GNOSIS_EASY_AUCTION, BYTES_ZERO } from "../test/helpers/constants";
import { sleep } from "../test/helpers/utils";
const { getContractAt } = ethers;
import { hexStripZeros } from "ethers/lib/utils";
var CronJob = require("cron").CronJob;

const program = new Command();
program.version("0.0.1");
program.option("-n, --network <network>", "Network", "mainnet");

program.parse(process.argv);

// 3600000 = 1hr
const TIMELOCK_PERIOD = 3600000;
// 0 10 * * 5 = 10am UTC on Fridays. https://crontab.guru/ is a friend
const CRON = "0 10 * * 5";

async function waitForAuctionClose(
  auctionCounters: Array,
  gnosisAuction: Contract
) {
  const auctionDetails = await gnosisAuction.auctionData(
    auctionCounters[auctionDetails.length - 1]
  );

  // Wait until the last initiated auction is finished
  await sleep(auctionDetails.auctionEndDate.sub(await time.now()).mul(1000));
}

async function settleAuctions(
  gnosisAuction: Contract,
  provider: object,
  signer: SignerWithAddress,
  auctionCounters: Array
) {
  for (let auctionID in auctionCounters) {
    const auctionDetails = await gnosisAuction.auctionData(auctionID);
    // If initialAuctionOrder is bytes32(0) auction has
    // already been settled as gnosis does gas refunds
    if (auctionDetails.initialAuctionOrder === BYTES_ZERO) {
      continue;
    }
    let gasPrice = await gas(network);
    const tx = await gnosisAuction.connect(signer).settleAuction({
      gasPrice,
    });
    console.log(`settleAuction (${auctionID}): ${tx.hash}`);
  }
}

async function runTX(
  vaultArtifactAbi: object,
  provider: object,
  signer: SignerWithAddress,
  method: string
) {
  let returnData = [];
  for (let vault in deployments[network]) {
    const vault = new ethers.Contract(
      deployments[network].vault,
      vaultArtifactAbi,
      provider
    );

    let gasPrice = await gas(network);

    const tx = await vault.connect(signer)[`${method}()`]({
      gasPrice,
    });
    console.log(`${method} (${vault}): ${tx.hash}`);

    if (method === "rollToNextOption") {
      const receipt = await tx.wait();
      returnData.push(
        hexStripZeros(receipt["logs"][15]["topics"][1]).toString().slice(2)
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

  const gnosisAuction = await getContractAt(
    "IGnosisAuction",
    GNOSIS_EASY_AUCTION
  );

  // Master Cron Job
  //
  // 1. commitAndClose
  await runTX(vaultArtifact.abi, provider, signer, "commitAndClose");
  // 2. wait an hour (timelock period)
  await sleep(TIMELOCK_PERIOD);
  // 3. rollToNextOption
  let auctionCounters = await runTX(
    vaultArtifact.abi,
    provider,
    signer,
    "rollToNextOption"
  );
  // 4. wait for auctions to close
  await waitForAuctionClose(auctionCounters, gnosisAuction);
  // 5. settleAuction
  await settleAuctions(gnosisAuction, provider, signer, auctionCounters);
  // 6. if otokens left to burn: burnRemainingOTokens
  await runTX(vaultArtifact.abi, provider, signer, "burnRemainingOTokens");
  // 7. wait approximately a week
}

//Atlantic/Reykjavik corresponds to UTC

var job = new CronJob(
  CRON,
  function () {
    await main();
  },
  null,
  true,
  "Atlantic/Reykjavik"
);

job.start();
