import { task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "hardhat-contract-sizer";
import "hardhat-log-remover";
import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "solidity-coverage";
import exportDeployments from "./scripts/tasks/exportDeployments";
import verifyContracts from "./scripts/tasks/verifyContracts";
import { BLOCK_NUMBER } from "./constants/constants";
import { TEST_URI } from "./scripts/helpers/getDefaultEthersProvider";

require("dotenv").config();

process.env.TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

// Defaults to CHAINID=1 so things will run with mainnet fork if not specified
const CHAINID = process.env.CHAINID ? Number(process.env.CHAINID) : 1;

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
      accounts: {
        mnemonic: process.env.TEST_MNEMONIC,
      },
      chainId: CHAINID,
      forking: {
        url: TEST_URI[CHAINID],
        blockNumber: BLOCK_NUMBER[CHAINID],
        gasLimit: 8e6,
      },
    },
    mainnet: {
      url: process.env.TEST_URI,
      chainId: CHAINID,
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
    avax: {
      url: process.env.AVAX_URI,
      chainId: 43114,
      accounts: {
        mnemonic: process.env.AVAX_MNEMONIC,
      },
    },
    fuji: {
      url: process.env.FUJI_URI,
      chainId: 43113,
      accounts: {
        mnemonic: process.env.FUJI_MNEMONIC,
      },
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
      1: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      42: "0x8DD47c24aC72888BFb2b75c172bB55C127515884",
      43114: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
    },
    owner: {
      default: 0,
      1: "0xAb6df2dE75a4f07D95c040DF90c7362bB5edcd90",
      42: "0x35364e2d193D423f106B92766088A71bFC9b8370",
      43114: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
    },
    keeper: {
      default: 0,
      1: "0xA4290C9EAe274c7A8FbC57A1E68AdC3E95E7C67e",
      42: "0x35364e2d193D423f106B92766088A71bFC9b8370",
      43114: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
    },
    admin: {
      default: 0,
      1: "0x88A9142fa18678003342a8Fd706Bd301E0FecEfd",
      42: "0x50378505679B9e7247ffe89EAa1b136131Ea8362",
      43114: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
    },
    feeRecipient: {
      default: 0,
      1: "0xDAEada3d210D2f45874724BeEa03C7d4BBD41674", // Ribbon DAO
      42: "0x35364e2d193D423f106B92766088A71bFC9b8370",
      43114: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
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
task("verify-contracts", "Verify solidity source", verifyContracts);
