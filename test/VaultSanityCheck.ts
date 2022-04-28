import { ethers, network, getNamedAccounts } from "hardhat";
import { assert } from "chai";
import { describe, it } from "mocha";
import {
  CHAINID,
  NULL_ADDR,
  ORACLE_DISPUTE_PERIOD,
} from "../constants/constants";
import { increaseTo } from "./helpers/time";

import AvaxRibbonThetaVaultLogic from "../deployments/avax/RibbonThetaVaultLogic.json";
import AvaxRibbonThetaVaultETHPut from "../deployments/avax/RibbonThetaVaultETHPut.json";
import AvaxRibbonThetaVaultSAVAXCall from "../deployments/avax/RibbonThetaVaultSAVAXCall.json";

const vaultParams = {
  avax: {
    nextOption: "0xE59E90aFFcd4535028E4897130bF532E035086E7",
    annualizedVol: 106480000,
  },
  savax: {
    nextOption: "0x82793eBEE4c86ca2C0aFce7032862091445e2e8c",
    annualizedVol: 106480000,
  },
};

describe("AVAX - VaultSanityCheck", () => {
  if (network.config.chainId !== CHAINID.AVAX_MAINNET) return;

  let keeperSigner;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            chainId: CHAINID.AVAX_MAINNET,
            jsonRpcUrl: process.env.AVAX_URI,
            blockNumber: 11308690,
          },
        },
      ],
    });

    const { keeper, owner, deployer } = await getNamedAccounts();

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [keeper],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [owner],
    });
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [deployer],
    });

    keeperSigner = await ethers.provider.getSigner(keeper);
  });

  it("AVAX Put #rollToNextOption changes current option", async () => {
    const Vault = await ethers.getContractAt(
      AvaxRibbonThetaVaultLogic.abi,
      AvaxRibbonThetaVaultETHPut.address
    );

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), NULL_ADDR);

    await Vault.connect(keeperSigner).commitAndClose();

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), vaultParams.avax.nextOption);

    await increaseTo(
      (await ethers.provider.getBlock("latest")).timestamp +
        ORACLE_DISPUTE_PERIOD
    );

    await Vault.connect(keeperSigner).rollToNextOption();

    assert.equal(await Vault.currentOption(), vaultParams.avax.nextOption);
    assert.equal(await Vault.nextOption(), NULL_ADDR);
  });

  it("sAVAX Call #rollToNextOption changes current option", async () => {
    const Vault = await ethers.getContractAt(
      AvaxRibbonThetaVaultLogic.abi,
      AvaxRibbonThetaVaultSAVAXCall.address
    );

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), NULL_ADDR);

    await Vault.connect(keeperSigner).commitAndClose();

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), vaultParams.savax.nextOption);

    await increaseTo(
      (await ethers.provider.getBlock("latest")).timestamp +
        ORACLE_DISPUTE_PERIOD
    );

    await Vault.connect(keeperSigner).rollToNextOption();

    assert.equal(await Vault.currentOption(), vaultParams.savax.nextOption);
    assert.equal(await Vault.nextOption(), NULL_ADDR);
  });
});
