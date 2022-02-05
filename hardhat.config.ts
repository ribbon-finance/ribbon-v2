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
      chainId: 42,
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
    aurora: {
      url: process.env.AURORA_URI,
      chainId: 1313161554,
      gasPrice: 0,
      accounts: {
        mnemonic: process.env.AURORA_MNEMONIC,
      },
    },
    "aurora-testnet": {
      url: process.env.AURORA_TESTNET_URI,
      chainId: 1313161555,
      accounts: {
        mnemonic: process.env.AURORA_TESTNET_MNEMONIC,
      },
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
      1: "0x691c87dc570563D1D0AD7Fd0bb099ED367858863",
      42: "0x422f7Bb366608723c8fe61Ac6D923023dCCBC3d7",
      43114: "0xd4816D144C005B29dF24C8eb1865fB8A1e79FdDE",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
      1313161554: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
      1313161555: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
    },
    owner: {
      default: 0,
      1: "0xAb6df2dE75a4f07D95c040DF90c7362bB5edcd90",
      42: "0x92Dd37fbc36cB7260F0d2BD09F9672525a028fB8",
      43114: "0x939cbb6BaBAad2b0533C2CACa8a4aFEc3ae06492",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
      1313161554: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
      1313161555: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
    },
    keeper: {
      default: 0,
      1: "0xA4290C9EAe274c7A8FbC57A1E68AdC3E95E7C67e",
      42: "0x92Dd37fbc36cB7260F0d2BD09F9672525a028fB8",
      43114: "0xA4290C9EAe274c7A8FbC57A1E68AdC3E95E7C67e",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
      1313161554: "0xA4290C9EAe274c7A8FbC57A1E68AdC3E95E7C67e",
      1313161555: "0xA4290C9EAe274c7A8FbC57A1E68AdC3E95E7C67e",
    },
    admin: {
      default: 0,
      1: "0x88A9142fa18678003342a8Fd706Bd301E0FecEfd",
      42: "0x422f7Bb366608723c8fe61Ac6D923023dCCBC3d7",
      43114: "0x31351f2BD9e94813BCf0cA04B5E6e2b7ceAFC7c6",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
      1313161554: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
      1313161555: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
    },
    feeRecipient: {
      default: 0,
      1: "0xDAEada3d210D2f45874724BeEa03C7d4BBD41674", // Ribbon DAO
      42: "0x92Dd37fbc36cB7260F0d2BD09F9672525a028fB8",
      43114: "0x939cbb6BaBAad2b0533C2CACa8a4aFEc3ae06492",
      43113: "0x004FCF8052D3c7eCb7558ac0068882425a055528",
      1313161554: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
      1313161555: "0x46B4E6143Fb6ded2e5FBd87887Ef4f50f716dcA0",
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
