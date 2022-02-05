import { ethers, network, getNamedAccounts } from "hardhat";
import { assert } from "chai";
import { describe, it } from "mocha";
import { CHAINID, NULL_ADDR, AURORA_USDC_POOL } from "../constants/constants";
import RibbonThetaVaultLogic from "../deployments/aurora/RibbonThetaVaultLogic.json";
import RibbonThetaVaultWNEARCall from "../deployments/aurora/RibbonThetaVaultWNEARCall.json";
import RibbonThetaVaultAURORACall from "../deployments/aurora/RibbonThetaVaultAURORACall.json";
import ManualVolOracle from "../deployments/aurora/ManualVolOracle.json";

beforeEach(async () => {
  if (network.config.chainId !== CHAINID.AURORA_MAINNET) {
    return;
  }
});

describe("Aurora - VaultSanityCheck", () => {
  const vaultParams = {
    near: {
      nextOption: '0x5366316bB6cC27F33C88c27e03bD54757FC91E28',
      annualizedVol: 106480000
    },
    aurora: {
      nextOption: '0xcCDe3B57996C7771529feC52562e335C85366381',
      annualizedVol: 106480000
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
            blockNumber: 58901375,
            jsonRpcUrl: process.env.AURORA_URI,
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

    // gasPrice = 0 on Aurora but hardhat is enforcing the baseFeePerGas at 1000000000
    // I'm assuming Aurora is not supported by hardhat (doesn't know gas is 0 on Aurora)
    await Vault.connect(keeperSigner).rollToNextOption({
      gasPrice: 1000000000,
    });

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
      106480000,
      { gasPrice: 1000000000 }
    );

    await Vault.connect(keeperSigner).commitAndClose({ gasPrice: 1000000000 });

    assert.equal(await Vault.currentOption(), NULL_ADDR);
    assert.equal(await Vault.nextOption(), vaultParams.aurora.nextOption);

    await Vault.connect(keeperSigner).rollToNextOption({
      gasPrice: 1000000000,
    });

    assert.equal(await Vault.currentOption(), vaultParams.aurora.nextOption);
    assert.equal(await Vault.nextOption(), NULL_ADDR);
  });
});
