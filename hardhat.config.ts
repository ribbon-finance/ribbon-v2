import { task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "hardhat-contract-sizer";
import "hardhat-log-remover";
import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "solidity-coverage";

require("dotenv").config();

process.env.TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

export default {
  accounts: {
    mnemonic: process.env.TEST_MNEMONIC,
  },
  paths: {
    deploy: "scripts/deploy",
    deployments: "deployments",
  },
  solidity: {
    version: "0.7.3",
    settings: {
      optimizer: {
        runs: 200,
        enabled: true,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.TEST_URI,
        gasLimit: 8e6,
        blockNumber: 12570201,
      },
    },
    rinkeby: {
      url: process.env.RINKEBY_URI,
      accounts: {
        mnemonic: process.env.RINKEBY_MNEMONIC,
      },
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
      1: 0,
      4: "0x56b7713abAd486E87Bb9e3ea5e47628881C472F2",
    },
    owner: {
      default: 0,
      1: 0,
      4: "0x56b7713abAd486E87Bb9e3ea5e47628881C472F2",
    },
    feeRecipient: {
      default: 0,
      1: 0,
      4: "0x56b7713abAd486E87Bb9e3ea5e47628881C472F2",
    },
  },
  mocha: {
    timeout: 500000,
  },
};
