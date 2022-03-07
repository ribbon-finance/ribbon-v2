import { ethers, network, getNamedAccounts } from "hardhat";
import { assert } from "chai";
import { describe, it } from "mocha";
import {
  CHAINID,
  NULL_ADDR,
  AURORA_USDC_POOL,
  ORACLE_DISPUTE_PERIOD,
} from "../constants/constants";
import { increaseTo } from "./helpers/time";

import AuroraManualVolOracle from "../deployments/aurora/ManualVolOracle.json";
import AuroraRibbonThetaVaultLogic from "../deployments/aurora/RibbonThetaVaultLogic.json";
import AuroraRibbonThetaVaultWNEARCall from "../deployments/aurora/RibbonThetaVaultWNEARCall.json";
import AuroraRibbonThetaVaultAURORACall from "../deployments/aurora/RibbonThetaVaultAURORACall.json";

import AvaxRibbonThetaVaultLogic from "../deployments/avax/RibbonThetaVaultLogic.json";
import AvaxRibbonThetaVaultETHPut from "../deployments/avax/RibbonThetaVaultETHPut.json";
import AvaxRibbonThetaVaultSAVAXCall from "../deployments/avax/RibbonThetaVaultSAVAXCall.json";

const vaultParams = {
  near: {
    nextOption: "0x5366316bB6cC27F33C88c27e03bD54757FC91E28",
    annualizedVol: 106480000,
  },
  aurora: {
    nextOption: "0xcCDe3B57996C7771529feC52562e335C85366381",
    annualizedVol: 106480000,
  },
  avax: {
    nextOption: "0xE59E90aFFcd4535028E4897130bF532E035086E7",
    annualizedVol: 106480000,
  },
  savax: {
    nextOption: "0x82793eBEE4c86ca2C0aFce7032862091445e2e8c",
    annualizedVol: 106480000,
  },
};

describe("Aurora - VaultSanityCheck", () => {
  if (network.config.chainId !== CHAINID.AURORA_MAINNET) return;

  let keeperSigner;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            chainId: CHAINID.AURORA_MAINNET,
            jsonRpcUrl: process.env.AURORA_URI,
            blockNumber: 58888759,
          },
        },
      ],
    });

    const { keeper } = await getNamedAccounts();

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [keeper],
    });

    keeperSigner = await ethers.provider.getSigner(keeper);
  });

  it("NEAR #rollToNextOption changes current option", async () => {
    const Vault = await ethers.getContractAt(
      AuroraRibbonThetaVaultLogic.abi,
      AuroraRibbonThetaVaultWNEARCall.address
    );

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), vaultParams.near.nextOption);

    await Vault.connect(keeperSigner).rollToNextOption();

    assert.equal(await Vault.currentOption(), vaultParams.near.nextOption);
    assert.equal(await Vault.nextOption(), NULL_ADDR);
  });

  it("AURORA #rollToNextOption changes current option", async () => {
    const Vault = await ethers.getContractAt(
      AuroraRibbonThetaVaultLogic.abi,
      AuroraRibbonThetaVaultAURORACall.address
    );

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), NULL_ADDR);

    const ManualVol = await ethers.getContractAt(
      AuroraManualVolOracle.abi,
      AuroraManualVolOracle.address
    );

    // We need to set manual vol to deploy the Aurora call vault
    await ManualVol.connect(keeperSigner).setAnnualizedVol(
      AURORA_USDC_POOL[CHAINID.AURORA_MAINNET],
      vaultParams.aurora.annualizedVol
    );

    await Vault.connect(keeperSigner).commitAndClose();

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), vaultParams.aurora.nextOption);

    await Vault.connect(keeperSigner).rollToNextOption();

    assert.equal(await Vault.currentOption(), vaultParams.aurora.nextOption);
    assert.equal(await Vault.nextOption(), NULL_ADDR);
  });
});

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
