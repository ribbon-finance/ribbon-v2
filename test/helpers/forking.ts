import { network, ethers } from "hardhat";

export const forkBlock = async (blockNumber: number) => {
  const currentBlockNumber = await ethers.provider.getBlockNumber();
  // If it is the same block, we avoid forking
  if (currentBlockNumber === blockNumber) {
    return;
  }

  await network.provider.request({
    method: "hardhat_reset",
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.TEST_URI,
          blockNumber,
        },
      },
    ],
  });
};
