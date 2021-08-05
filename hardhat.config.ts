import { task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "hardhat-contract-sizer";
import "hardhat-log-remover";
import "solidity-coverage";
import deployThetaVault from "./scripts/deploy/deployThetaVault";

require("dotenv").config();

process.env.TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

export default {
  accounts: {
    mnemonic: process.env.TEST_MNEMONIC,
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
    },
  },
  mocha: {
    timeout: 500000,
  },
};

task("deployThetaVault", "Deploys Theta Vault")
  .addParam("underlying", "Underlying")
  .setAction(deployThetaVault);
