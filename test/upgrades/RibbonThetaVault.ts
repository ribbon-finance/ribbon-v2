import { assert } from "chai";
import { ethers, network } from "hardhat";

const FORK_BLOCK = 13280723;
const ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

interface StorageValues {
  totalSupply: string;
  name: string;
  symbol: string;
}

describe("RibbonThetaVault upgrade", () => {
  before(async function () {
    // We need to checkpoint the contract on mainnet to a past block before the upgrade happens
    // This means the `implementation` is pointing to an old contract
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: FORK_BLOCK,
          },
        },
      ],
    });
  });

  const UPGRADE_ADMIN = "";
  const VAULTS = [
    "0x25751853Eab4D0eB3652B5eB6ecB102A2789644B",
    // "0x65a833afDc250D9d38f8CD9bC2B1E3132dB13B2F",
  ];
  const UPGRADES = [];

  checkIfStorageNotCorrupted("0x25751853Eab4D0eB3652B5eB6ecB102A2789644B", {
    totalSupply:
      "0x00000000000000000000000000000000000000000000001032666f9c7ded91ad",
    name: "0x526962626f6e20455448205468657461205661756c740000000000000000002c", // Ribbon ETH Theta Vault
    symbol:
      "0x724554482d544845544100000000000000000000000000000000000000000014", // symbol - rETH-THETA
  });
});

function checkIfStorageNotCorrupted(
  vaultAddress: string,
  storageValues: StorageValues
) {
  const { totalSupply, name, symbol } = storageValues;

  const getVaultStorage = async (storageIndex: number | string) => {
    return await ethers.provider.getStorageAt(vaultAddress, storageIndex);
  };

  const storageLayout = [
    [
      ADMIN_SLOT,
      "0x000000000000000000000000223d59fa315d7693df4238d1a5748c964e615923",
    ],
    [
      IMPLEMENTATION_SLOT,
      "0x000000000000000000000000c4d1009dff06a63a5548ecfeaf0942d45cf027c5",
    ],
    [0, "0x0000000000000000000000000000000000000000000000000000000000000001"], // initializable
    [1, "0x0000000000000000000000000000000000000000000000000000000000000001"], // reentrancy
    [101, "0x00000000000000000000000077da011d5314d80be59e939c2f7ec2f702e1dcc4"], // owner
    [153, totalSupply], // totalSupply
    [154, name], // name
    [155, symbol], // symbol
  ];

  describe(`Vault ${vaultAddress}`, () => {
    it("has the correct initial storage state", async () => {
      for (let i = 0; i < storageLayout.length; i++) {
        const [index, value] = storageLayout[i];
        assert.equal(
          await getVaultStorage(index),
          value,
          `Mismatched value at index ${index}`
        );
      }
    });
  });
}
