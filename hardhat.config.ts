import { task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "hardhat-contract-sizer";
import "hardhat-log-remover";
import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "solidity-coverage";
import exportDeployments from "./scripts/tasks/exportDeployments";

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
    version: "0.8.4",
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
    mainnet: {
      url: process.env.MAINNET_URI,
      accounts: {
        mnemonic: process.env.MAINNET_MNEMONIC,
      },
    },
    kovan: {
      url: process.env.KOVAN_URI,
      accounts: {
        mnemonic: process.env.KOVAN_MNEMONIC,
      },
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
      1: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      42: "0x8DD47c24aC72888BFb2b75c172bB55C127515884",
    },
    owner: {
      default: 0,
      1: "0xAb6df2dE75a4f07D95c040DF90c7362bB5edcd90",
      42: "0x35364e2d193D423f106B92766088A71bFC9b8370",
    },
    keeper: {
      default: 0,
      1: "0xAb6df2dE75a4f07D95c040DF90c7362bB5edcd90",
      42: "0x35364e2d193D423f106B92766088A71bFC9b8370",
    },
    admin: {
      default: 0,
      1: "0x88A9142fa18678003342a8Fd706Bd301E0FecEfd",
      42: "0x50378505679B9e7247ffe89EAa1b136131Ea8362",
    },
    feeRecipient: {
      default: 0,
      1: "0xAb6df2dE75a4f07D95c040DF90c7362bB5edcd90",
      42: "0x35364e2d193D423f106B92766088A71bFC9b8370",
    },
  },
  mocha: {
    timeout: 500000,
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};

task("export-deployments", "Exports deployments into JSON", exportDeployments);
