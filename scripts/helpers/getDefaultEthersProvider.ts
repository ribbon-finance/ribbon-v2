import { ethers } from "ethers";

require("dotenv").config();

export type Networks = "mainnet" | "kovan" | "rinkeby";

export const getDefaultProvider = (network: Networks = "kovan") => {
  let url: string;

  switch (network) {
    case "mainnet":
      url = process.env.MAINNET_URI;
      break;
    case "kovan":
      url = process.env.KOVAN_URI;
      break;
    case "rinkeby":
      url = process.env.RINKEBY_URI;
      break;
  }

  const provider = new ethers.providers.JsonRpcProvider(url);

  return provider;
};

export const getDefaultSigner = (path: string, network: Networks = "kovan") => {
  let mnemonic: string;

  switch (network) {
    case "mainnet":
      mnemonic = process.env.MNEMONIC;
      break;
    case "kovan":
      mnemonic = process.env.KOVAN_MNEMONIC;
      break;
    case "rinkeby":
      mnemonic = process.env.RINKEBY_MNEMONIC;
      break;
  }

  if (!mnemonic) {
    throw new Error("No mnemonic set");
  }
  const signer = ethers.Wallet.fromMnemonic(mnemonic, path);
  return signer.connect(getDefaultProvider(network));
};
