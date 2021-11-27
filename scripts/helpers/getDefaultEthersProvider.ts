import { ethers } from "ethers";
import { CHAINID } from "../../constants/constants";

require("dotenv").config();

export const TEST_URI = {
  [CHAINID.ETH_MAINNET]: process.env.TEST_URI,
  [CHAINID.AVAX_MAINNET]: process.env.AVAX_URI,
  [CHAINID.AVAX_FUJI]: process.env.FUJI_URI,
};

export type Networks = "mainnet" | "kovan";

export const getDefaultProvider = (network: Networks = "kovan") => {
  const url =
    network === "mainnet"
      ? process.env.MAINNET_URI
      : process.env.INFURA_KOVAN_URI;

  const provider = new ethers.providers.JsonRpcProvider(url);

  return provider;
};

export const getDefaultSigner = (path: string, network: Networks = "kovan") => {
  const mnemonic =
    network === "mainnet"
      ? process.env.MAINNET_MNEMONIC
      : process.env.KOVAN_MNEMONIC;

  if (!mnemonic) {
    throw new Error("No mnemonic set");
  }
  const signer = ethers.Wallet.fromMnemonic(mnemonic, path);
  return signer;
};
