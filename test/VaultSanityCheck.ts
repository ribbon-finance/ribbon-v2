import { ethers, network, getNamedAccounts } from "hardhat";
import { assert } from "chai";
import { describe, it } from "mocha";
import { CHAINID, NULL_ADDR, AURORA_USDC_POOL } from "../constants/constants";
import RibbonThetaVaultLogic from "../deployments/aurora/RibbonThetaVaultLogic.json";
import RibbonThetaVaultWNEARCall from "../deployments/aurora/RibbonThetaVaultWNEARCall.json";
import RibbonThetaVaultAURORACall from "../deployments/aurora/RibbonThetaVaultAURORACall.json";
import ManualVolOracle from "../deployments/aurora/ManualVolOracle.json";

describe("Aurora - VaultSanityCheck", () => {
  if (network.config.chainId !== CHAINID.AURORA_MAINNET) return;

  const vaultParams = {
    near: {
      nextOption: "0x5366316bB6cC27F33C88c27e03bD54757FC91E28",
      annualizedVol: 106480000,
    },
    aurora: {
      nextOption: "0xcCDe3B57996C7771529feC52562e335C85366381",
      annualizedVol: 106480000,
    },
  };

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
      RibbonThetaVaultLogic.abi,
      RibbonThetaVaultWNEARCall.address
    );

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), vaultParams.near.nextOption);

    await Vault.connect(keeperSigner).rollToNextOption();

    assert.equal(await Vault.currentOption(), vaultParams.near.nextOption);
    assert.equal(await Vault.nextOption(), NULL_ADDR);
  });

  it("AURORA #rollToNextOption changes current option", async () => {
    const Vault = await ethers.getContractAt(
      RibbonThetaVaultLogic.abi,
      RibbonThetaVaultAURORACall.address
    );

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), NULL_ADDR);

    const ManualVol = await ethers.getContractAt(
      ManualVolOracle.abi,
      ManualVolOracle.address
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
