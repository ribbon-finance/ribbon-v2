import { ethers } from "ethers";

require("dotenv").config();

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
    network === "mainnet" ? process.env.MNEMONIC : process.env.KOVAN_MNEMONIC;

  if (!mnemonic) {
    throw new Error("No mnemonic set");
  }
  const signer = ethers.Wallet.fromMnemonic(mnemonic, path);
  return signer;
};
