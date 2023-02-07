import { ethers, network } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { NULL_ADDR, PLACEHOLDER_ADDR } from "../../constants/constants";
import { assert } from "../helpers/assertions";

describe("VaultDeploymentEventEmitter", () => {
  let vaultDeploymentEventEmitter: Contract;
  let owner: SignerWithAddress;
  let account: SignerWithAddress;

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: 15038742,
          },
        },
      ],
    });

    [owner, account] = await ethers.getSigners();

    const existingVaultAddresses = [
      "0x8b5876f5B0Bf64056A89Aa7e97511644758c3E8c", // Normal - WBTC Calls v1
      "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A", // Normal - ETH Calls v1
      "0x8FE74471F198E426e96bE65f40EeD1F8BA96e54f", // Normal - ETH Puts v1 (yvUSDC)
      "0x16772a7f4a3ca291C21B8AcE76F9332dDFfbb5Ef", // Normal - ETH Puts v1 (USDC)
      "0xe63151A0Ed4e5fafdc951D877102cf0977Abd365", // Normal - AAVE Covered Call V2
      "0xc0cF10Dd710aefb209D9dc67bc746510ffd98A53", // Normal - APE Covered Call V2
      "0x25751853Eab4D0eB3652B5eB6ecB102A2789644B", // Normal - ETH Covered Call V2
      "0x53773E034d9784153471813dacAFF53dBBB78E8c", // Normal - stETH Covered Call
      "0x65a833afDc250D9d38f8CD9bC2B1E3132dB13B2F", // Normal - WBTC Covered Call V2
      "0xCc323557c71C0D1D20a1861Dc69c06C5f3cC9624", // Normal - ETH Put-Selling Vault V2
      "0xA1Da0580FA96129E753D736a5901C31Df5eC5edf", // Normal - rETH Covered Call V2

      "0x84c2b16fa6877a8ff4f3271db7ea837233dfd6f0", // Earn - Ribbon USDC Earn Vault
      "0xce5513474e077f5336cf1b33c1347fdd8d48ae8c", // Earn - Ribbon stETH Earn Vault

      "0x1e2d05bd78bd50eaa380ef71f86430ed20301bf5", // Treasury - Ribbon SAMB Treasury Vault (old)
      "0x8D93ac93Bd8f6C0c1c1955f0B9Fe8508281A869C", // Treasury - Ribbon SAMB Treasury Vault (new)
      "0x270f4a26a3fe5766ccef9608718491bb057be238", // Treasury - Ribbon BADGER Treasury Vault
      "0x2a6b048eb15c7d4ddca27db4f9a454196898a0fe", // Treasury - Ribbon BAL Treasury Vault
      "0x42cf874bbe5564efcf252bc90829551f4ec639dc", // Treasury - Ribbon SPELL Treasury Vault
      "0xe44edf7ad1d434afe3397687dd0a914674f2e405", // Treasury - Ribbon PERP Treasury Vault

      "0x34B44791fc1aAAc1120994a885c9Df6CDE50ECda", // VIP - Ribbon VIP VOL Vault
      "0x5D5b71Eb15075810225c7dcD9e82ae344224e9Eb", // VIP - Ribbon USDC Earn Vault (vip)
      "0x06275be44E6F886c4E470DCF880f5Fb960d79d1c", // VIP - Ribbon wBTC Earn Vault
      "0x0dD119Bea1BF0eDc4fd9C7E96bB829eC3f5013A1", // VIP - Ribbon VIP VOL Vault Two
    ];
    const existingVaultTypes = [
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3,
    ];

    const VaultDeploymentEventEmitter = await ethers.getContractFactory(
      "VaultDeploymentEventEmitter"
    );
    vaultDeploymentEventEmitter = await VaultDeploymentEventEmitter.connect(
      owner
    ).deploy(existingVaultAddresses, existingVaultTypes);
  });

  describe("#constructor", () => {
    it("correctly initializes normal vaults", async () => {
      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(0), [
        "0x8b5876f5B0Bf64056A89Aa7e97511644758c3E8c",
        "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A",
        "0x8FE74471F198E426e96bE65f40EeD1F8BA96e54f",
        "0x16772a7f4a3ca291C21B8AcE76F9332dDFfbb5Ef",
        "0xe63151A0Ed4e5fafdc951D877102cf0977Abd365",
        "0xc0cF10Dd710aefb209D9dc67bc746510ffd98A53",
        "0x25751853Eab4D0eB3652B5eB6ecB102A2789644B",
        "0x53773E034d9784153471813dacAFF53dBBB78E8c",
        "0x65a833afDc250D9d38f8CD9bC2B1E3132dB13B2F",
        "0xCc323557c71C0D1D20a1861Dc69c06C5f3cC9624",
        "0xA1Da0580FA96129E753D736a5901C31Df5eC5edf",
      ]);
    });
    it("correctly initializes earn vaults", async () => {
      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(1), [
        "0x84c2b16FA6877a8fF4F3271db7ea837233DFd6f0",
        "0xCE5513474E077F5336cf1B33c1347FDD8D48aE8c",
      ]);
    });
    it("correctly initializes treasury vaults", async () => {
      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(2), [
        "0x1e2D05BD78bD50Eaa380Ef71F86430ED20301bF5",
        "0x8D93ac93Bd8f6C0c1c1955f0B9Fe8508281A869C",
        "0x270F4a26a3fE5766CcEF9608718491bb057Be238",
        "0x2a6B048eB15C7d4ddCa27db4f9A454196898A0Fe",
        "0x42cf874bBe5564EfCF252bC90829551f4ec639DC",
        "0xe44eDF7aD1D434Afe3397687DD0A914674F2E405",
      ]);
    });
    it("correctly initializes vip vaults", async () => {
      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(3), [
        "0x34B44791fc1aAAc1120994a885c9Df6CDE50ECda",
        "0x5D5b71Eb15075810225c7dcD9e82ae344224e9Eb",
        "0x06275be44E6F886c4E470DCF880f5Fb960d79d1c",
        "0x0dD119Bea1BF0eDc4fd9C7E96bB829eC3f5013A1",
      ]);
    });
  });

  describe("#newVault", () => {
    it("reverts when the caller is not the owner", async () => {
      await expect(
        vaultDeploymentEventEmitter
          .connect(account)
          .newVault(PLACEHOLDER_ADDR, 0)
      ).to.be.revertedWith("caller is not the owner");
    });
    it("reverts when address zero is passed", async () => {
      await expect(
        vaultDeploymentEventEmitter.connect(owner).newVault(NULL_ADDR, 0)
      ).to.be.revertedWith("!_newVaultAddress");
    });
    it("reverts when invalid vault type is passed", async () => {
      await expect(
        vaultDeploymentEventEmitter.connect(owner).newVault(NULL_ADDR, 6)
      ).to.be.reverted;
    });
    it("successfully emits the event with the new vault address", async () => {
      const tx = await vaultDeploymentEventEmitter
        .connect(owner)
        .newVault(PLACEHOLDER_ADDR, 0);

      await expect(tx)
        .to.emit(vaultDeploymentEventEmitter, "NewVault")
        .withArgs(PLACEHOLDER_ADDR, 0);

      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(0), [
        "0x8b5876f5B0Bf64056A89Aa7e97511644758c3E8c",
        "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A",
        "0x8FE74471F198E426e96bE65f40EeD1F8BA96e54f",
        "0x16772a7f4a3ca291C21B8AcE76F9332dDFfbb5Ef",
        "0xe63151A0Ed4e5fafdc951D877102cf0977Abd365",
        "0xc0cF10Dd710aefb209D9dc67bc746510ffd98A53",
        "0x25751853Eab4D0eB3652B5eB6ecB102A2789644B",
        "0x53773E034d9784153471813dacAFF53dBBB78E8c",
        "0x65a833afDc250D9d38f8CD9bC2B1E3132dB13B2F",
        "0xCc323557c71C0D1D20a1861Dc69c06C5f3cC9624",
        "0xA1Da0580FA96129E753D736a5901C31Df5eC5edf",
        PLACEHOLDER_ADDR,
      ]);
    });
  });

  describe("#getVaultAddresses", () => {
    it("reverts when invalid vault type is passed", async () => {
      await expect(vaultDeploymentEventEmitter.getVaultAddresses(6)).to.be
        .reverted;
    });
    it("successfully returns the correct value", async () => {
      assert.deepEqual(await vaultDeploymentEventEmitter.getVaultAddresses(0), [
        "0x8b5876f5B0Bf64056A89Aa7e97511644758c3E8c",
        "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A",
        "0x8FE74471F198E426e96bE65f40EeD1F8BA96e54f",
        "0x16772a7f4a3ca291C21B8AcE76F9332dDFfbb5Ef",
        "0xe63151A0Ed4e5fafdc951D877102cf0977Abd365",
        "0xc0cF10Dd710aefb209D9dc67bc746510ffd98A53",
        "0x25751853Eab4D0eB3652B5eB6ecB102A2789644B",
        "0x53773E034d9784153471813dacAFF53dBBB78E8c",
        "0x65a833afDc250D9d38f8CD9bC2B1E3132dB13B2F",
        "0xCc323557c71C0D1D20a1861Dc69c06C5f3cC9624",
        "0xA1Da0580FA96129E753D736a5901C31Df5eC5edf",
        PLACEHOLDER_ADDR,
      ]);
    });
  });
});
