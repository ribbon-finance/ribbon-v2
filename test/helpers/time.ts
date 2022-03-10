import { ethers } from "hardhat";
import { BigNumber } from "ethers";

export const DELAY_INCREMENT = 100;

// Increases ganache time by the passed duration in seconds
export async function increase(duration: number | BigNumber) {
  if (!BigNumber.isBigNumber(duration)) {
    duration = BigNumber.from(duration);
  }

  if (duration.lt(BigNumber.from("0")))
    throw Error(`Cannot increase time by a negative amount (${duration})`);

  await ethers.provider.send("evm_increaseTime", [duration.toNumber()]);

  await ethers.provider.send("evm_mine", []);
}

// gets current time
export async function now() {
  return BigNumber.from((await ethers.provider.getBlock("latest")).timestamp);
}

/**
 * Beware that due to the need of calling two separate ganache methods and rpc calls overhead
 * it's hard to increase time precisely to a target point so design your test to tolerate
 * small fluctuations from time to time.
 *
 * @param target time in seconds
 */
export async function increaseTo(target: number | BigNumber) {
  if (!BigNumber.isBigNumber(target)) {
    target = BigNumber.from(target);
  }

  const now = BigNumber.from(
    (await ethers.provider.getBlock("latest")).timestamp
  );

  if (target.lt(now))
    throw Error(
      `Cannot increase current time (${now}) to a moment in the past (${target})`
    );

  const diff = target.sub(now);
  return increase(diff);
}

export async function takeSnapshot() {
  const snapshotId: string = await ethers.provider.send("evm_snapshot", []);
  return snapshotId;
}

export async function revertToSnapShot(id: string) {
  await ethers.provider.send("evm_revert", [id]);
}

export function revertToSnapshotAfterTest() {
  let snapshotId: string;

  before(async () => {
    snapshotId = await takeSnapshot();
  });
  after(async () => {
    await revertToSnapShot(snapshotId);
  });
}

export function revertToSnapshotAfterEach(
  beforeEachCallback = async () => {},
  afterEachCallback = async () => {}
) {
  let snapshotId: string;

  beforeEach(async function () {
    snapshotId = await takeSnapshot();

    await beforeEachCallback.bind(this)(); // eslint-disable-line no-invalid-this
  });
  afterEach(async () => {
    await afterEachCallback.bind(this)(); // eslint-disable-line no-invalid-this

    await revertToSnapShot(snapshotId);
  });
}

export const PERIOD = 43200; // 12 hours
export const getTopOfPeriod = async () => {
  const latestTimestamp = (await ethers.provider.getBlock("latest")).timestamp;
  let topOfPeriod: number;

  const rem = latestTimestamp % PERIOD;
  if (rem < Math.floor(PERIOD / 2)) {
    topOfPeriod = latestTimestamp - rem + PERIOD;
  } else {
    topOfPeriod = latestTimestamp + rem + PERIOD;
  }
  return topOfPeriod;
};
