import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, constants, Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";

import moment from "moment-timezone";
import * as time from "./helpers/time";
import {
  CHAINID,
  BLOCK_NUMBER,
  USDC_ADDRESS,
  USDC_OWNER_ADDRESS,
  WETH_ADDRESS,
  SQUEETH_CONTROLLER,
  SQUEETH_ORACLE,
  UNISWAP_ROUTER,
  UNISWAP_FACTORY,
  USDC_WETH_POOL,
  SQTH_WETH_POOL,
} from "../constants/constants";
import {
  deployProxy,
  mintToken,
  lockedBalanceForRollover,
} from "./helpers/utils";
import { wmul } from "./helpers/math";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "./helpers/assertions";
import { TEST_URI } from "../scripts/helpers/getDefaultEthersProvider";
const { provider, getContractAt, getContractFactory } = ethers;
const { parseEther } = ethers.utils;

moment.tz.setDefault("UTC");

const OPTION_DELAY = 0;
const DELAY_INCREMENT = 100;
const gasPrice = parseUnits("30", "gwei");
const FEE_SCALING = BigNumber.from(10).pow(6);
const WEEKS_PER_YEAR = 52142857;

const chainId = network.config.chainId;

describe("RibbonGammaVault", () => {
  // Addresses
  let owner: string, keeper: string, user: string, feeRecipient: string;

  // Signers
  let adminSigner: SignerWithAddress,
    userSigner: SignerWithAddress,
    ownerSigner: SignerWithAddress,
    keeperSigner: SignerWithAddress,
    feeRecipientSigner: SignerWithAddress;

  // Parameters
  const tokenName = "Ribbon USDC Gamma Vault";
  const tokenSymbol = "rUSDC-GAMMA";
  const tokenDecimals = 6;
  const minimumSupply = BigNumber.from("10").pow("3").toString();
  const asset = USDC_ADDRESS[chainId];
  const collateralAsset = USDC_ADDRESS[chainId];
  const depositAmount = BigNumber.from("100000000000");
  const managementFee = BigNumber.from("2000000");
  const performanceFee = BigNumber.from("20000000");

  const gasLimits = {
    depositWorstCase: 101000,
    depositBestCase: 90000,
  };

  // Contracts
  let vaultLifecycleLib: Contract;
  let vaultLifecycleGammaLib: Contract;
  let vault: Contract;
  let assetContract: Contract;

  describe(`${tokenName}`, () => {
    let initSnapshotId: string;

    before(async function () {
      // Reset block
      await network.provider.request({
        method: "hardhat_reset",
        params: [
          {
            forking: {
              jsonRpcUrl: TEST_URI[chainId],
              blockNumber: BLOCK_NUMBER[chainId],
            },
          },
        ],
      });

      initSnapshotId = await time.takeSnapshot();

      [adminSigner, ownerSigner, keeperSigner, userSigner, feeRecipientSigner] =
        await ethers.getSigners();
      owner = ownerSigner.address;
      keeper = keeperSigner.address;
      user = userSigner.address;
      feeRecipient = feeRecipientSigner.address;

      const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
      vaultLifecycleLib = await VaultLifecycle.deploy();

      const VaultLifecycleGamma = await ethers.getContractFactory(
        "VaultLifecycleGamma"
      );
      vaultLifecycleGammaLib = await VaultLifecycleGamma.deploy();

      const initializeArgs = [
        [
          owner,
          keeper,
          feeRecipient,
          managementFee,
          performanceFee,
          tokenName,
          tokenSymbol,
          BigNumber.from(0),
          BigNumber.from(0),
          "0x",
          "0x",
        ],
        [
          false,
          tokenDecimals,
          USDC_ADDRESS[chainId],
          asset,
          minimumSupply,
          parseUnits("50000000", 6),
        ],
      ];

      const deployArgs = [
        WETH_ADDRESS[chainId],
        USDC_ADDRESS[chainId],
        SQUEETH_CONTROLLER[chainId],
        SQUEETH_ORACLE[chainId],
        UNISWAP_ROUTER[chainId],
        UNISWAP_FACTORY[chainId],
        USDC_WETH_POOL[chainId],
        SQTH_WETH_POOL[chainId],
      ];

      vault = (
        await deployProxy(
          "RibbonGammaVault",
          adminSigner,
          initializeArgs,
          deployArgs,
          {
            libraries: {
              VaultLifecycle: vaultLifecycleLib.address,
              VaultLifecycleGamma: vaultLifecycleGammaLib.address,
            },
          }
        )
      ).connect(userSigner);

      await vault.initRounds(50);

      assetContract = await getContractAt("IWBTC", collateralAsset);

      const addressToDeposit = [userSigner, ownerSigner, adminSigner];
      for (let i = 0; i < addressToDeposit.length; i++) {
        await mintToken(
          assetContract,
          USDC_OWNER_ADDRESS[chainId],
          addressToDeposit[i].address,
          vault.address,
          depositAmount
        );
      }
    });

    after(async () => {
      await time.revertToSnapShot(initSnapshotId);
    });

    describe("#initialize", () => {
      let testVault: Contract;

      time.revertToSnapshotAfterEach(async function () {
        const RibbonGammaVault = await ethers.getContractFactory(
          "RibbonGammaVault",
          {
            libraries: {
              VaultLifecycle: vaultLifecycleLib.address,
              VaultLifecycleGamma: vaultLifecycleGammaLib.address,
            },
          }
        );
        testVault = await RibbonGammaVault.deploy(
          WETH_ADDRESS[chainId],
          USDC_ADDRESS[chainId],
          SQUEETH_CONTROLLER[chainId],
          SQUEETH_ORACLE[chainId],
          UNISWAP_ROUTER[chainId],
          UNISWAP_FACTORY[chainId],
          USDC_WETH_POOL[chainId],
          SQTH_WETH_POOL[chainId]
        );
      });

      it.skip("initializes with correct values", async function () {
        assert.equal(
          (await vault.cap()).toString(),
          parseUnits("500", tokenDecimals > 18 ? tokenDecimals : 18)
        );
        assert.equal(await vault.owner(), owner);
        assert.equal(await vault.keeper(), keeper);
        assert.equal(await vault.feeRecipient(), feeRecipient);
        assert.equal(
          (await vault.managementFee()).toString(),
          managementFee.mul(FEE_SCALING).div(WEEKS_PER_YEAR).toString()
        );
        assert.equal(
          (await vault.performanceFee()).toString(),
          performanceFee.toString()
        );

        const [
          isPut,
          decimals,
          assetFromContract,
          underlying,
          minimumSupply,
          cap,
        ] = await vault.vaultParams();
        assert.equal(await decimals, tokenDecimals);
        assert.equal(decimals, tokenDecimals);
        assert.equal(assetFromContract, collateralAsset);
        assert.equal(underlying, asset);
        assert.equal(await vault.WETH(), WETH_ADDRESS[chainId]);
        assert.equal(await vault.USDC(), USDC_ADDRESS[chainId]);
        assert.bnEqual(await vault.totalPending(), BigNumber.from(0));
        assert.equal(minimumSupply, minimumSupply);
        assert.equal(isPut, false);
        // assert.equal(
        //   (await vault.premiumDiscount()).toString(),
        //   params.premiumDiscount.toString()
        // );
        assert.bnEqual(cap, parseUnits("500", 6));
        // assert.equal(
        //   await vault.optionsPremiumPricer(),
        //   optionsPremiumPricer.address
        // );
        // assert.equal(await vault.strikeSelection(), strikeSelection.address);
        // assert.equal(await vault.auctionDuration(), auctionDuration);
      });

      it("cannot be initialized twice", async function () {
        await expect(
          vault.initialize(
            [
              owner,
              keeper,
              feeRecipient,
              managementFee,
              performanceFee,
              tokenName,
              tokenSymbol,
              BigNumber.from(0),
              BigNumber.from(0),
              "0x",
              "0x",
            ],
            [
              false,
              tokenDecimals,
              USDC_ADDRESS[chainId],
              asset,
              minimumSupply,
              parseUnits("500", 6),
            ]
          )
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });

      it("reverts when initializing with 0 owner", async function () {
        await expect(
          testVault.initialize(
            [
              constants.AddressZero,
              keeper,
              feeRecipient,
              managementFee,
              performanceFee,
              tokenName,
              tokenSymbol,
              BigNumber.from(0),
              BigNumber.from(0),
              "0x",
              "0x",
            ],
            [
              false,
              tokenDecimals,
              USDC_ADDRESS[chainId],
              asset,
              minimumSupply,
              parseUnits("500", 6),
            ]
          )
        ).to.be.revertedWith("!owner");
      });

      it("reverts when initializing with 0 keeper", async function () {
        await expect(
          testVault.initialize(
            [
              owner,
              constants.AddressZero,
              feeRecipient,
              managementFee,
              performanceFee,
              tokenName,
              tokenSymbol,
              BigNumber.from(0),
              BigNumber.from(0),
              "0x",
              "0x",
            ],
            [
              false,
              tokenDecimals,
              USDC_ADDRESS[chainId],
              asset,
              minimumSupply,
              parseUnits("500", 6),
            ]
          )
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when initializing with 0 feeRecipient", async function () {
        await expect(
          testVault.initialize(
            [
              owner,
              keeper,
              constants.AddressZero,
              managementFee,
              performanceFee,
              tokenName,
              tokenSymbol,
              BigNumber.from(0),
              BigNumber.from(0),
              "0x",
              "0x",
            ],
            [
              false,
              tokenDecimals,
              USDC_ADDRESS[chainId],
              asset,
              minimumSupply,
              parseUnits("500", 6),
            ]
          )
        ).to.be.revertedWith("!feeRecipient");
      });

      it("reverts when initializing with 0 initCap", async function () {
        await expect(
          testVault.initialize(
            [
              owner,
              keeper,
              feeRecipient,
              managementFee,
              performanceFee,
              tokenName,
              tokenSymbol,
              BigNumber.from(0),
              BigNumber.from(0),
              "0x",
              "0x",
            ],
            [
              false,
              tokenDecimals,
              USDC_ADDRESS[chainId],
              asset,
              minimumSupply,
              BigNumber.from(0),
            ]
          )
        ).to.be.revertedWith("!cap");
      });

      it.skip("reverts when asset is 0x", async function () {
        await expect(
          testVault.initialize(
            [
              owner,
              keeper,
              feeRecipient,
              managementFee,
              performanceFee,
              tokenName,
              tokenSymbol,
              BigNumber.from(0),
              BigNumber.from(0),
              "0x",
              "0x",
            ],
            [
              false,
              tokenDecimals,
              constants.AddressZero,
              asset,
              minimumSupply,
              parseUnits("500", 6),
            ]
          )
        ).to.be.revertedWith("!asset");
      });
    });

    describe("#name", () => {
      it("returns the name", async function () {
        assert.equal(await vault.name(), tokenName);
      });
    });

    describe("#symbol", () => {
      it("returns the symbol", async function () {
        assert.equal(await vault.symbol(), tokenSymbol);
      });
    });

    describe("#owner", () => {
      it("returns the owner", async function () {
        assert.equal(await vault.owner(), owner);
      });
    });

    describe("#managementFee", () => {
      it("returns the management fee", async function () {
        assert.equal(
          (await vault.managementFee()).toString(),
          managementFee.mul(FEE_SCALING).div(WEEKS_PER_YEAR).toString()
        );
      });
    });

    describe("#performanceFee", () => {
      it("returns the performance fee", async function () {
        assert.equal(
          (await vault.performanceFee()).toString(),
          performanceFee.toString()
        );
      });
    });

    describe("#setNewKeeper", () => {
      time.revertToSnapshotAfterTest();

      it("set new keeper to owner", async function () {
        assert.equal(await vault.keeper(), keeper);
        await vault.connect(ownerSigner).setNewKeeper(owner);
        assert.equal(await vault.keeper(), owner);
      });

      it("reverts when not owner call", async function () {
        await expect(vault.setNewKeeper(owner)).to.be.revertedWith(
          "caller is not the owner"
        );
      });
    });

    describe("#setFeeRecipient", () => {
      time.revertToSnapshotAfterTest();

      it("reverts when setting 0x0 as feeRecipient", async function () {
        await expect(
          vault.connect(ownerSigner).setFeeRecipient(constants.AddressZero)
        ).to.be.revertedWith("!newFeeRecipient");
      });

      it("reverts when not owner call", async function () {
        await expect(vault.setFeeRecipient(owner)).to.be.revertedWith(
          "caller is not the owner"
        );
      });

      it("changes the fee recipient", async function () {
        await vault.connect(ownerSigner).setFeeRecipient(owner);
        assert.equal(await vault.feeRecipient(), owner);
      });
    });

    describe("#setManagementFee", () => {
      time.revertToSnapshotAfterTest();

      it("setManagementFee to 0", async function () {
        await vault.connect(ownerSigner).setManagementFee(0);
        assert.bnEqual(await vault.managementFee(), BigNumber.from(0));
      });

      it("reverts when not owner call", async function () {
        await expect(
          vault.setManagementFee(BigNumber.from("1000000").toString())
        ).to.be.revertedWith("caller is not the owner");
      });

      it("changes the management fee", async function () {
        await vault
          .connect(ownerSigner)
          .setManagementFee(BigNumber.from("1000000").toString());
        assert.equal(
          (await vault.managementFee()).toString(),
          BigNumber.from(1000000)
            .mul(FEE_SCALING)
            .div(WEEKS_PER_YEAR)
            .toString()
        );
      });
    });

    describe("#setPerformanceFee", () => {
      time.revertToSnapshotAfterTest();

      it("setPerformanceFee to 0", async function () {
        await vault.connect(ownerSigner).setPerformanceFee(0);
        assert.bnEqual(await vault.performanceFee(), BigNumber.from(0));
      });

      it("reverts when not owner call", async function () {
        await expect(
          vault.setPerformanceFee(BigNumber.from("1000000").toString())
        ).to.be.revertedWith("caller is not the owner");
      });

      it("changes the performance fee", async function () {
        await vault
          .connect(ownerSigner)
          .setPerformanceFee(BigNumber.from("1000000").toString());
        assert.equal(
          (await vault.performanceFee()).toString(),
          BigNumber.from("1000000").toString()
        );
      });
    });

    describe("#deposit", () => {
      time.revertToSnapshotAfterEach();

      it("creates a pending deposit", async function () {
        const startBalance = await assetContract.balanceOf(user);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);

        const res = await vault.deposit(depositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(user),
          startBalance.sub(depositAmount)
        );
        assert.isTrue((await vault.totalSupply()).isZero());
        assert.isTrue((await vault.balanceOf(user)).isZero());
        await expect(res)
          .to.emit(vault, "Deposit")
          .withArgs(user, depositAmount, 1);

        assert.bnEqual(await vault.totalPending(), depositAmount);
        const { round, amount } = await vault.depositReceipts(user);
        assert.equal(round, 1);
        assert.bnEqual(amount, depositAmount);
      });

      it.skip("tops up existing deposit", async function () {
        const startBalance = await assetContract.balanceOf(user);
        const totalDepositAmount = depositAmount.mul(BigNumber.from(2));

        await assetContract
          .connect(userSigner)
          .approve(vault.address, totalDepositAmount);

        await vault.deposit(depositAmount);

        const tx = await vault.deposit(depositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(user),
          startBalance.sub(totalDepositAmount)
        );
        assert.isTrue((await vault.totalSupply()).isZero());
        assert.isTrue((await vault.balanceOf(user)).isZero());
        await expect(tx)
          .to.emit(vault, "Deposit")
          .withArgs(user, depositAmount, 1);

        assert.bnEqual(await vault.totalPending(), totalDepositAmount);
        const { round, amount } = await vault.depositReceipts(user);
        assert.equal(round, 1);
        assert.bnEqual(amount, totalDepositAmount);
      });

      it.skip("fits gas budget for deposits [ @skip-on-coverage ]", async function () {
        await vault.connect(ownerSigner).deposit(depositAmount);

        const tx1 = await vault.deposit(depositAmount);
        const receipt1 = await tx1.wait();
        assert.isAtMost(
          receipt1.gasUsed.toNumber(),
          gasLimits.depositWorstCase
        );

        const tx2 = await vault.deposit(depositAmount);
        const receipt2 = await tx2.wait();
        assert.isAtMost(receipt2.gasUsed.toNumber(), gasLimits.depositBestCase);

        // Uncomment to log gas used
        // console.log("Worst case deposit", receipt1.gasUsed.toNumber());
        // console.log("Best case deposit", receipt2.gasUsed.toNumber());
      });

      it("does not inflate the share tokens on initialization", async function () {
        const depositAmount = BigNumber.from("100000000000");

        await assetContract
          .connect(adminSigner)
          .transfer(vault.address, depositAmount);

        await vault.connect(userSigner).deposit(BigNumber.from("10000000000"));

        // user needs to get back exactly 1 ether
        // even though the total has been incremented
        assert.isTrue((await vault.balanceOf(user)).isZero());
      });

      it("reverts when minimum shares are not minted", async function () {
        await expect(
          vault
            .connect(userSigner)
            .deposit(BigNumber.from(minimumSupply).sub(BigNumber.from("1")))
        ).to.be.revertedWith("Insufficient balance");
      });

      it("updates the previous deposit receipt", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount.mul(2));

        await vault.deposit(depositAmount);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(user);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, depositAmount);
        assert.bnEqual(unredeemedShares1, BigNumber.from(0));

        // await rollToNextOption();

        // const {
        //   round: round2,
        //   amount: amount2,
        //   unredeemedShares: unredeemedShares2,
        // } = await vault.depositReceipts(user);

        // assert.equal(round2, 1);
        // assert.bnEqual(amount2, params.depositAmount);
        // assert.bnEqual(unredeemedShares2, BigNumber.from(0));

        // await vault.deposit(params.depositAmount);

        // assert.bnEqual(
        //   await assetContract.balanceOf(vault.address),
        //   params.depositAmount
        // );
        // // vault will still hold the vault shares
        // assert.bnEqual(
        //   await vault.balanceOf(vault.address),
        //   params.depositAmount
        // );

        // const {
        //   round: round3,
        //   amount: amount3,
        //   unredeemedShares: unredeemedShares3,
        // } = await vault.depositReceipts(user);

        // assert.equal(round3, 2);
        // assert.bnEqual(amount3, params.depositAmount);
        // assert.bnEqual(unredeemedShares3, params.depositAmount);
      });
    });

    describe("#depositFor", () => {
      time.revertToSnapshotAfterEach();
      let creditor: String;

      beforeEach(async function () {
        creditor = ownerSigner.address.toString();
      });

      it("creates a pending deposit", async function () {
        const startBalance = await assetContract.balanceOf(user);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);

        const res = await vault.depositFor(depositAmount, creditor);

        assert.bnEqual(
          await assetContract.balanceOf(user),
          startBalance.sub(depositAmount)
        );
        assert.isTrue((await vault.totalSupply()).isZero());
        assert.isTrue((await vault.balanceOf(user)).isZero());
        await expect(res)
          .to.emit(vault, "Deposit")
          .withArgs(creditor, depositAmount, 1);

        assert.bnEqual(await vault.totalPending(), depositAmount);
        const { round, amount } = await vault.depositReceipts(creditor);
        assert.equal(round, 1);
        assert.bnEqual(amount, depositAmount);
        const { round2, amount2 } = await vault.depositReceipts(user);
        await expect(round2).to.be.undefined;
        await expect(amount2).to.be.undefined;
      });

      it.skip("tops up existing deposit", async function () {
        const startBalance = await assetContract.balanceOf(user);
        const totalDepositAmount = depositAmount.mul(BigNumber.from(2));

        await assetContract
          .connect(userSigner)
          .approve(vault.address, totalDepositAmount);

        await vault.depositFor(depositAmount, creditor);

        const tx = await vault.depositFor(depositAmount, creditor);

        assert.bnEqual(
          await assetContract.balanceOf(user),
          startBalance.sub(totalDepositAmount)
        );
        assert.isTrue((await vault.totalSupply()).isZero());
        assert.isTrue((await vault.balanceOf(creditor)).isZero());
        await expect(tx)
          .to.emit(vault, "Deposit")
          .withArgs(creditor, depositAmount, 1);

        assert.bnEqual(await vault.totalPending(), totalDepositAmount);
        const { round, amount } = await vault.depositReceipts(creditor);
        assert.equal(round, 1);
        assert.bnEqual(amount, totalDepositAmount);
      });

      it.skip("fits gas budget for deposits [ @skip-on-coverage ]", async function () {
        await vault.connect(ownerSigner).depositFor(depositAmount, creditor);

        const tx1 = await vault.depositFor(depositAmount, creditor);
        const receipt1 = await tx1.wait();
        assert.isAtMost(
          receipt1.gasUsed.toNumber(),
          gasLimits.depositWorstCase
        );

        const tx2 = await vault.depositFor(depositAmount, creditor);
        const receipt2 = await tx2.wait();
        assert.isAtMost(receipt2.gasUsed.toNumber(), gasLimits.depositBestCase);

        // Uncomment to log gas used
        // console.log("Worst case deposit", receipt1.gasUsed.toNumber());
        // console.log("Best case deposit", receipt2.gasUsed.toNumber());
      });

      it("does not inflate the share tokens on initialization", async function () {
        const depositAmount = BigNumber.from("100000000000");

        await assetContract
          .connect(adminSigner)
          .transfer(vault.address, depositAmount);

        await vault
          .connect(userSigner)
          .depositFor(BigNumber.from("10000000000"), creditor);

        // user needs to get back exactly 1 ether
        // even though the total has been incremented
        assert.isTrue((await vault.balanceOf(creditor)).isZero());
      });

      it("reverts when minimum shares are not minted", async function () {
        await expect(
          vault
            .connect(userSigner)
            .depositFor(
              BigNumber.from(minimumSupply).sub(BigNumber.from("1")),
              creditor
            )
        ).to.be.revertedWith("Insufficient balance");
      });

      it("updates the previous deposit receipt", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount.mul(2));

        await vault.depositFor(depositAmount, creditor);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(creditor);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, depositAmount);
        assert.bnEqual(unredeemedShares1, BigNumber.from(0));

        // await rollToNextOption();

        // const {
        //   round: round2,
        //   amount: amount2,
        //   unredeemedShares: unredeemedShares2,
        // } = await vault.depositReceipts(creditor);

        // assert.equal(round2, 1);
        // assert.bnEqual(amount2, params.depositAmount);
        // assert.bnEqual(unredeemedShares2, BigNumber.from(0));

        // await vault.depositFor(params.depositAmount, creditor);

        // assert.bnEqual(
        //   await assetContract.balanceOf(vault.address),
        //   params.depositAmount
        // );
        // // vault will still hold the vault shares
        // assert.bnEqual(
        //   await vault.balanceOf(vault.address),
        //   params.depositAmount
        // );

        // const {
        //   round: round3,
        //   amount: amount3,
        //   unredeemedShares: unredeemedShares3,
        // } = await vault.depositReceipts(creditor);

        // assert.equal(round3, 2);
        // assert.bnEqual(amount3, params.depositAmount);
        // assert.bnEqual(unredeemedShares3, params.depositAmount);
      });
    });

    // describe("#rollToNextOption", () => {

    //   time.revertToSnapshotAfterEach(async function () {
    //     await vault.depost(depositAmount);
    //   });

    //   it("reverts when not called with keeper", async function () {
    //     await expect(
    //       vault.connect(ownerSigner).rollToNextOption()
    //     ).to.be.revertedWith("!keeper");
    //   });

    //   it("mints oTokens and deposits collateral into vault", async function () {
    //     await vault.connect(ownerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const res = await vault.connect(keeperSigner).rollToNextOption();

    //     await expect(res).to.not.emit(vault, "CloseShort");

    //     await expect(res)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(defaultOtokenAddress, depositAmount, keeper);

    //     const vaultState = await vault.vaultState();

    //     assert.equal(vaultState.lockedAmount.toString(), depositAmount);

    //     assert.bnEqual(
    //       await assetContract.balanceOf(vault.address),
    //       BigNumber.from(0)
    //     );

    //     assert.equal(
    //       (await assetContract.balanceOf(MARGIN_POOL))
    //         .sub(startMarginBalance)
    //         .toString(),
    //       depositAmount.toString()
    //     );

    //     assert.bnEqual(
    //       await defaultOtoken.balanceOf(GNOSIS_EASY_AUCTION[chainId]),
    //       params.expectedMintAmount
    //     );

    //     assert.equal(await vault.currentOption(), defaultOtokenAddress);
    //   });

    //   it("starts auction with correct parameters", async function () {
    //     await vault.connect(ownerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const nextOption = await getContractAt(
    //       "IOtoken",
    //       await vault.nextOption()
    //     );

    //     await vault.connect(keeperSigner).rollToNextOption();

    //     const currentAuctionCounter = await gnosisAuction.auctionCounter();
    //     const auctionDetails = await gnosisAuction.auctionData(
    //       currentAuctionCounter.toString()
    //     );
    //     const feeNumerator = await gnosisAuction.feeNumerator();
    //     const feeDenominator = await gnosisAuction.FEE_DENOMINATOR();

    //     assert.equal(auctionDetails.auctioningToken, defaultOtokenAddress);
    //     assert.equal(auctionDetails.biddingToken, collateralAsset);
    //     assert.equal(
    //       auctionDetails.orderCancellationEndDate.toString(),
    //       (await time.now()).add(21600).toString()
    //     );
    //     assert.equal(
    //       auctionDetails.auctionEndDate.toString(),
    //       (await time.now()).add(21600).toString()
    //     );
    //     assert.equal(
    //       auctionDetails.minimumBiddingAmountPerOrder.toString(),
    //       "1"
    //     );
    //     assert.equal(auctionDetails.isAtomicClosureAllowed, false);
    //     assert.equal(
    //       auctionDetails.feeNumerator.toString(),
    //       feeNumerator.toString()
    //     );
    //     assert.equal(auctionDetails.minFundingThreshold.toString(), "0");
    //     assert.equal(
    //       await gnosisAuction.auctionAccessManager(currentAuctionCounter),
    //       constants.AddressZero
    //     );
    //     assert.equal(
    //       await gnosisAuction.auctionAccessData(currentAuctionCounter),
    //       "0x"
    //     );

    //     const initialAuctionOrder = decodeOrder(
    //       auctionDetails.initialAuctionOrder
    //     );

    //     const oTokenSellAmount = params.expectedMintAmount
    //       .mul(feeDenominator)
    //       .div(feeDenominator.add(feeNumerator));

    //     const oTokenPremium = (
    //       await optionsPremiumPricer.getPremium(
    //         await nextOption.strikePrice(),
    //         await nextOption.expiryTimestamp(),
    //         params.isPut
    //       )
    //     )
    //       .mul(await vault.premiumDiscount())
    //       .div(1000);
    //     assert.equal(
    //       initialAuctionOrder.sellAmount.toString(),
    //       oTokenSellAmount.toString()
    //     );
    //     let decimals = tokenDecimals;

    //     let bid = wmul(
    //       oTokenSellAmount.mul(BigNumber.from(10).pow(10)),
    //       oTokenPremium
    //     );
    //     bid =
    //       decimals > 18
    //         ? bid.mul(BigNumber.from(10).pow(decimals - 18))
    //         : bid.div(BigNumber.from(10).pow(18 - decimals));
    //     assert.equal(initialAuctionOrder.buyAmount.toString(), bid.toString());

    //     // Hardcoded
    //     // assert.equal(auctionDetails.interimSumBidAmount, 0);
    //     // assert.equal(auctionDetails.interimOrder, IterableOrderedOrderSet.QUEUE_START);
    //     // assert.equal(auctionDetails.clearingPriceOrder, bytes32(0));
    //     // assert.equal(auctionDetails.volumeClearingPriceOrder, 0);
    //     // assert.equal(auctionDetails.minFundingThresholdNotReached, false);
    //   });

    //   it("reverts when calling before expiry", async function () {
    //     const EXPECTED_ERROR = "31";

    //     const firstOptionAddress = firstOption.address;

    //     await vault.connect(ownerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(keeperSigner).rollToNextOption();

    //     await expect(firstTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(firstOptionAddress, depositAmount, keeper);

    //     // 100% of the vault's balance is allocated to short
    //     assert.bnEqual(
    //       await assetContract.balanceOf(vault.address),
    //       BigNumber.from(0)
    //     );

    //     await expect(
    //       vault.connect(ownerSigner).commitAndClose()
    //     ).to.be.revertedWith(EXPECTED_ERROR);
    //   });

    //   it("withdraws and roll funds into next option, after expiry ITM", async function () {
    //     const firstOptionAddress = firstOption.address;
    //     const secondOptionAddress = secondOption.address;

    //     await vault.connect(ownerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(keeperSigner).rollToNextOption();

    //     assert.equal(await vault.currentOption(), firstOptionAddress);
    //     assert.equal(await getCurrentOptionExpiry(), firstOption.expiry);

    //     await expect(firstTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(firstOptionAddress, depositAmount, keeper);

    //     await time.increaseTo(
    //       (await provider.getBlock("latest")).timestamp + auctionDuration
    //     );

    //     // We just settle the auction without any bids
    //     // So we simulate a loss when the options expire in the money
    //     await gnosisAuction
    //       .connect(userSigner)
    //       .settleAuction(await gnosisAuction.auctionCounter());

    //     const settlementPriceITM = isPut
    //       ? firstOptionStrike.sub(1)
    //       : firstOptionStrike.add(1);

    //     // withdraw 100% because it's OTM
    //     await setOpynOracleExpiryPrice(
    //       params.asset,
    //       oracle,
    //       await getCurrentOptionExpiry(),
    //       settlementPriceITM
    //     );

    //     const beforeBalance = await assetContract.balanceOf(vault.address);

    //     await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

    //     const firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

    //     const afterBalance = await assetContract.balanceOf(vault.address);

    //     // test that the vault's balance decreased after closing short when ITM
    //     assert.isAbove(
    //       parseInt(depositAmount.toString()),
    //       parseInt(BigNumber.from(afterBalance).sub(beforeBalance).toString())
    //     );

    //     await expect(firstCloseTx)
    //       .to.emit(vault, "CloseShort")
    //       .withArgs(
    //         firstOptionAddress,
    //         BigNumber.from(afterBalance).sub(beforeBalance),
    //         owner
    //       );

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const currBalance = await assetContract.balanceOf(vault.address);

    //     const secondTx = await vault.connect(keeperSigner).rollToNextOption();

    //     assert.equal(await vault.currentOption(), secondOptionAddress);
    //     assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);

    //     await expect(secondTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(secondOptionAddress, currBalance, keeper);

    //     assert.bnEqual(
    //       await assetContract.balanceOf(vault.address),
    //       BigNumber.from(0)
    //     );
    //   });

    //   it("reverts when calling before expiry", async function () {
    //     const EXPECTED_ERROR = "C31";

    //     const firstOptionAddress = firstOption.address;

    //     await vault.connect(ownerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(keeperSigner).rollToNextOption();

    //     await expect(firstTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(firstOptionAddress, depositAmount, keeper);

    //     // 100% of the vault's balance is allocated to short
    //     assert.bnEqual(
    //       await assetContract.balanceOf(vault.address),
    //       BigNumber.from(0)
    //     );

    //     await expect(
    //       vault.connect(ownerSigner).commitAndClose()
    //     ).to.be.revertedWith(EXPECTED_ERROR);
    //   });

    //   it("withdraws and roll funds into next option, after expiry OTM", async function () {
    //     const firstOptionAddress = firstOption.address;
    //     const secondOptionAddress = secondOption.address;

    //     await vault.connect(ownerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(keeperSigner).rollToNextOption();

    //     await expect(firstTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(firstOptionAddress, depositAmount, keeper);

    //     let bidMultiplier = 1;

    //     const auctionDetails = await bidForOToken(
    //       gnosisAuction,
    //       assetContract,
    //       userSigner.address,
    //       defaultOtokenAddress,
    //       firstOptionPremium,
    //       tokenDecimals,
    //       bidMultiplier.toString(),
    //       auctionDuration
    //     );

    //     await gnosisAuction
    //       .connect(userSigner)
    //       .settleAuction(auctionDetails[0]);

    //     // Asset balance when auction closes only contains auction proceeds
    //     // Remaining vault's balance is still in Opyn Gamma Controller
    //     let auctionProceeds = await assetContract.balanceOf(vault.address);

    //     // only the premium should be left over because the funds are locked into Opyn
    //     assert.isAbove(
    //       parseInt((await assetContract.balanceOf(vault.address)).toString()),
    //       (parseInt(auctionProceeds.toString()) * 99) / 100
    //     );

    //     const settlementPriceOTM = isPut
    //       ? firstOptionStrike.add(1)
    //       : firstOptionStrike.sub(1);

    //     // withdraw 100% because it's OTM
    //     await setOpynOracleExpiryPrice(
    //       params.asset,
    //       oracle,
    //       await getCurrentOptionExpiry(),
    //       settlementPriceOTM
    //     );

    //     const beforeBalance = await assetContract.balanceOf(vault.address);

    //     await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

    //     const firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

    //     const afterBalance = await assetContract.balanceOf(vault.address);
    //     // test that the vault's balance decreased after closing short when ITM
    //     assert.equal(
    //       parseInt(depositAmount.toString()),
    //       parseInt(BigNumber.from(afterBalance).sub(beforeBalance).toString())
    //     );

    //     await expect(firstCloseTx)
    //       .to.emit(vault, "CloseShort")
    //       .withArgs(
    //         firstOptionAddress,
    //         BigNumber.from(afterBalance).sub(beforeBalance),
    //         owner
    //       );

    //     // Time increase to after next option available
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     let pendingAmount = (await vault.vaultState()).totalPending;
    //     let [secondInitialLockedBalance, queuedWithdrawAmount] =
    //       await lockedBalanceForRollover(vault);

    //     const secondInitialTotalBalance = await vault.totalBalance();

    //     const secondTx = await vault.connect(keeperSigner).rollToNextOption();

    //     let vaultFees = secondInitialLockedBalance
    //       .add(queuedWithdrawAmount)
    //       .sub(pendingAmount)
    //       .mul(await vault.managementFee())
    //       .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));

    //     vaultFees = vaultFees.add(
    //       secondInitialLockedBalance
    //         .add(queuedWithdrawAmount)
    //         .sub((await vault.vaultState()).lastLockedAmount)
    //         .sub(pendingAmount)
    //         .mul(await vault.performanceFee())
    //         .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
    //     );

    //     const totalBalanceAfterFee = await vault.totalBalance();

    //     assert.equal(
    //       secondInitialTotalBalance.sub(totalBalanceAfterFee).toString(),
    //       vaultFees.toString()
    //     );

    //     assert.equal(await vault.currentOption(), secondOptionAddress);
    //     assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);

    //     await expect(secondTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(
    //         secondOptionAddress,
    //         depositAmount.add(auctionProceeds).sub(vaultFees),
    //         keeper
    //       );

    //     assert.equal(
    //       (await assetContract.balanceOf(vault.address)).toString(),
    //       BigNumber.from(0)
    //     );
    //   });

    //   it("withdraws and roll funds into next option, after expiry OTM (initiateWithdraw)", async function () {
    //     await depositIntoVault(
    //       params.collateralAsset,
    //       vault,
    //       depositAmount,
    //       ownerSigner
    //     );
    //     await vault.connect(ownerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     await vault.connect(keeperSigner).rollToNextOption();
    //     await vault
    //       .connect(ownerSigner)
    //       .initiateWithdraw(params.depositAmount.div(2));

    //     // withdraw 100% because it's OTM
    //     await setOpynOracleExpiryPrice(
    //       params.asset,
    //       oracle,
    //       await getCurrentOptionExpiry(),
    //       firstOptionStrike
    //     );

    //     await vault.connect(ownerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     await vault.connect(keeperSigner).rollToNextOption();

    //     let [, queuedWithdrawAmountInitial] = await lockedBalanceForRollover(
    //       vault
    //     );

    //     let bidMultiplier = 1;

    //     const auctionDetails = await bidForOToken(
    //       gnosisAuction,
    //       assetContract,
    //       userSigner.address,
    //       await vault.currentOption(),
    //       (await vault.currentOtokenPremium()).mul(105).div(100),
    //       tokenDecimals,
    //       bidMultiplier.toString(),
    //       auctionDuration
    //     );

    //     await gnosisAuction
    //       .connect(userSigner)
    //       .settleAuction(auctionDetails[0]);

    //     let newOptionStrike = await (
    //       await getContractAt("IOtoken", await vault.currentOption())
    //     ).strikePrice();
    //     const settlementPriceOTM = isPut
    //       ? newOptionStrike.add(1)
    //       : newOptionStrike.sub(1);

    //     // withdraw 100% because it's OTM
    //     await setOpynOracleExpiryPrice(
    //       params.asset,
    //       oracle,
    //       await getCurrentOptionExpiry(),
    //       settlementPriceOTM
    //     );

    //     await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

    //     await vault.initiateWithdraw(params.depositAmount.div(2));

    //     await vault.connect(ownerSigner).commitAndClose();

    //     // Time increase to after next option available
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     let pendingAmount = (await vault.vaultState()).totalPending;
    //     let [secondInitialLockedBalance, queuedWithdrawAmount] =
    //       await lockedBalanceForRollover(vault);

    //     const secondInitialBalance = await vault.totalBalance();

    //     await vault.connect(keeperSigner).rollToNextOption();

    //     let vaultFees = secondInitialLockedBalance
    //       .add(queuedWithdrawAmount.sub(queuedWithdrawAmountInitial))
    //       .sub(pendingAmount)
    //       .mul(await vault.managementFee())
    //       .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));
    //     vaultFees = vaultFees.add(
    //       secondInitialLockedBalance
    //         .add(queuedWithdrawAmount.sub(queuedWithdrawAmountInitial))
    //         .sub((await vault.vaultState()).lastLockedAmount)
    //         .sub(pendingAmount)
    //         .mul(await vault.performanceFee())
    //         .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
    //     );

    //     assert.equal(
    //       secondInitialBalance.sub(await vault.totalBalance()).toString(),
    //       vaultFees.toString()
    //     );
    //   });

    //   it("does not debit the user on first deposit", async () => {
    //     await vault.connect(ownerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     // totalBalance should remain the same before and after roll
    //     const startBalance = await vault.totalBalance();

    //     await vault.connect(keeperSigner).rollToNextOption();

    //     assert.bnEqual(await vault.totalBalance(), startBalance);
    //     assert.bnEqual(await vault.accountVaultBalance(user), depositAmount);

    //     // simulate a profit by transferring some tokens
    //     await assetContract
    //       .connect(userSigner)
    //       .transfer(vault.address, BigNumber.from(1));

    //     // totalBalance should remain the same before and after roll
    //     const secondStartBalance = await vault.totalBalance();

    //     // await rollToSecondOption(firstOptionStrike);

    //     // // After the first round, the user is charged the fee
    //     // assert.bnLt(await vault.totalBalance(), secondStartBalance);
    //     // assert.bnLt(await vault.accountVaultBalance(user), depositAmount);
    //   });

    //   it("fits gas budget [ @skip-on-coverage ]", async function () {
    //     await vault.connect(ownerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const tx = await vault.connect(keeperSigner).rollToNextOption();
    //     const receipt = await tx.wait();

    //     assert.isAtMost(receipt.gasUsed.toNumber(), 1006000); //963542, 1082712
    //     // console.log("rollToNextOption", receipt.gasUsed.toNumber());
    //   });
    // });

    describe("#assetBalance", () => {
      time.revertToSnapshotAfterEach(async function () {
        await vault.deposit(depositAmount);

        // await rollToNextOption();
      });

      it.skip("returns the free balance - locked, if free > locked", async function () {
        const newDepositAmount = BigNumber.from("1000000000000");
        await vault.deposit(newDepositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          newDepositAmount
        );
      });
    });

    describe("#maxRedeem", () => {
      time.revertToSnapshotAfterEach();

      it("is able to redeem deposit at new price per share", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);

        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // const tx = await vault.maxRedeem();

        // assert.bnEqual(
        //   await assetContract.balanceOf(vault.address),
        //   BigNumber.from(0)
        // );
        // assert.bnEqual(await vault.balanceOf(user), depositAmount);
        // assert.bnEqual(await vault.balanceOf(vault.address), BigNumber.from(0));

        // await expect(tx)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, depositAmount, 1);

        // const { round, amount, unredeemedShares } = await vault.depositReceipts(
        //   user
        // );

        // assert.equal(round, 1);
        // assert.bnEqual(amount, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares, BigNumber.from(0));
      });

      it("changes balance only once when redeeming twice", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);

        // await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await vault.maxRedeem();

        // assert.bnEqual(
        //   await assetContract.balanceOf(vault.address),
        //   BigNumber.from(0)
        // );
        // assert.bnEqual(await vault.balanceOf(user), depositAmount);
        // assert.bnEqual(await vault.balanceOf(vault.address), BigNumber.from(0));

        // const { round, amount, unredeemedShares } = await vault.depositReceipts(
        //   user
        // );

        // assert.equal(round, 1);
        // assert.bnEqual(amount, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares, BigNumber.from(0));

        // let res = await vault.maxRedeem();

        // await expect(res).to.not.emit(vault, "Transfer");

        // assert.bnEqual(
        //   await assetContract.balanceOf(vault.address),
        //   BigNumber.from(0)
        // );
        // assert.bnEqual(await vault.balanceOf(user), depositAmount);
        // assert.bnEqual(await vault.balanceOf(vault.address), BigNumber.from(0));
      });

      it("redeems after a deposit what was unredeemed from previous rounds", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount.mul(2));
        await vault.deposit(depositAmount);
        // await rollToNextOption();

        // await vault.deposit(depositAmount);

        // const tx = await vault.maxRedeem();

        // await expect(tx)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, depositAmount, 2);
      });

      it("is able to redeem deposit at correct pricePerShare after closing short in the money", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);

        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);

        // Mid-week deposit in round 1
        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        // await vault.connect(ownerSigner).commitAndClose();
        // await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        // await vault.connect(keeperSigner).rollToNextOption();

        // // Mid-week deposit in round 2
        // await vault.connect(userSigner).deposit(params.depositAmount);

        // const vaultState = await vault.vaultState();

        // const beforeBalance = (
        //   await assetContract.balanceOf(vault.address)
        // ).add(vaultState.lockedAmount);

        // const beforePps = await vault.pricePerShare();

        // const AMOUNT = {
        //   [CHAINID.ETH_MAINNET]: "100000000000",
        //   [CHAINID.AVAX_MAINNET]: "1000000000",
        // };

        // const settlementPriceITM = isPut
        //   ? firstOptionStrike.sub(AMOUNT[chainId])
        //   : firstOptionStrike.add(AMOUNT[chainId]);

        // // withdraw 100% because it's OTM
        // await setOpynOracleExpiryPrice(
        //   params.asset,
        //   oracle,
        //   await getCurrentOptionExpiry(),
        //   settlementPriceITM
        // );

        // await strikeSelection.setDelta(params.deltaSecondOption);

        // await vault.connect(ownerSigner).commitAndClose();
        // const afterBalance = await assetContract.balanceOf(vault.address);
        // const afterPps = await vault.pricePerShare();
        // const expectedMintAmountAfterLoss = params.depositAmount
        //   .mul(BigNumber.from(10).pow(params.tokenDecimals))
        //   .div(afterPps);

        // await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        // await vault.connect(keeperSigner).rollToNextOption();

        // assert.bnGt(beforeBalance, afterBalance);
        // assert.bnGt(beforePps, afterPps);

        // // owner should lose money
        // // User should not lose money
        // // owner redeems the deposit from round 1 so there is a loss from ITM options
        // const tx1 = await vault.connect(ownerSigner).maxRedeem();
        // await expect(tx1)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(owner, params.depositAmount, 1);

        // const {
        //   round: round1,
        //   amount: amount1,
        //   unredeemedShares: unredeemedShares1,
        // } = await vault.depositReceipts(owner);
        // assert.equal(round1, 1);
        // assert.bnEqual(amount1, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares1, BigNumber.from(0));
        // assert.bnEqual(await vault.balanceOf(owner), params.depositAmount);

        // // User deposit in round 2 so no loss
        // // we should use the pps after the loss which is the lower pps
        // const tx2 = await vault.connect(userSigner).maxRedeem();
        // await expect(tx2)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, expectedMintAmountAfterLoss, 2);

        // const {
        //   round: round2,
        //   amount: amount2,
        //   unredeemedShares: unredeemedShares2,
        // } = await vault.depositReceipts(user);
        // assert.equal(round2, 2);
        // assert.bnEqual(amount2, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares2, BigNumber.from(0));
        // assert.bnEqual(
        //   await vault.balanceOf(user),
        //   expectedMintAmountAfterLoss
        // );
      });
    });

    describe("#redeem", () => {
      time.revertToSnapshotAfterEach();

      it("reverts when 0 passed", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        // await rollToNextOption();
        // await expect(vault.redeem(0)).to.be.revertedWith("!numShares");
      });

      it("reverts when redeeming more than available", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await expect(vault.redeem(depositAmount.add(1))).to.be.revertedWith(
        //   "Exceeds available"
        // );
      });

      it("decreases unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // const redeemAmount = BigNumber.from(1);
        // const tx1 = await vault.redeem(redeemAmount);

        // await expect(tx1)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, redeemAmount, 1);

        // const {
        //   round: round1,
        //   amount: amount1,
        //   unredeemedShares: unredeemedShares1,
        // } = await vault.depositReceipts(user);

        // assert.equal(round1, 1);
        // assert.bnEqual(amount1, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares1, depositAmount.sub(redeemAmount));

        // const tx2 = await vault.redeem(depositAmount.sub(redeemAmount));

        // await expect(tx2)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, depositAmount.sub(redeemAmount), 1);

        // const {
        //   round: round2,
        //   amount: amount2,
        //   unredeemedShares: unredeemedShares2,
        // } = await vault.depositReceipts(user);

        // assert.equal(round2, 1);
        // assert.bnEqual(amount2, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares2, BigNumber.from(0));
      });
    });

    describe("#withdrawInstantly", () => {
      time.revertToSnapshotAfterEach();

      it("reverts with 0 amount", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await expect(vault.withdrawInstantly(0)).to.be.revertedWith("!amount");
      });

      it("reverts when withdrawing more than available", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await expect(
          vault.withdrawInstantly(depositAmount.add(1))
        ).to.be.revertedWith("Exceed amount");
      });

      it("reverts when deposit receipt is processed", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await vault.maxRedeem();

        // await expect(
        //   vault.withdrawInstantly(depositAmount.add(1))
        // ).to.be.revertedWith("Invalid round");
      });

      it("reverts when withdrawing next round", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await expect(
        //   vault.withdrawInstantly(depositAmount.add(1))
        // ).to.be.revertedWith("Invalid round");
      });

      it("withdraws the amount in deposit receipt", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        let startBalance: BigNumber;
        let withdrawAmount: BigNumber;
        if (collateralAsset === WETH_ADDRESS[chainId]) {
          startBalance = await provider.getBalance(user);
        } else {
          startBalance = await assetContract.balanceOf(user);
        }

        const tx = await vault.withdrawInstantly(depositAmount, { gasPrice });
        const receipt = await tx.wait();

        if (collateralAsset === WETH_ADDRESS[chainId]) {
          const endBalance = await provider.getBalance(user);
          withdrawAmount = endBalance
            .sub(startBalance)
            .add(receipt.gasUsed.mul(gasPrice));
        } else {
          const endBalance = await assetContract.balanceOf(user);
          withdrawAmount = endBalance.sub(startBalance);
        }
        assert.bnEqual(withdrawAmount, depositAmount);

        await expect(tx)
          .to.emit(vault, "InstantWithdraw")
          .withArgs(user, depositAmount, 1);

        const { round, amount } = await vault.depositReceipts(user);
        assert.equal(round, 1);
        assert.bnEqual(amount, BigNumber.from(0));

        // Should decrement the pending amounts
        assert.bnEqual(await vault.totalPending(), BigNumber.from(0));
      });
    });

    describe("#initiateWithdraw", () => {
      time.revertToSnapshotAfterEach();

      it("reverts when user initiates withdraws without any deposit", async function () {
        await expect(vault.initiateWithdraw(depositAmount)).to.be.revertedWith(
          "ERC20: transfer amount exceeds balance"
        );
      });

      it("reverts when passed 0 shares", async function () {
        await expect(vault.initiateWithdraw(0)).to.be.revertedWith(
          "!numShares"
        );
      });

      it("reverts when withdrawing more than unredeemed balance", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await expect(
        //   vault.initiateWithdraw(depositAmount.add(1))
        // ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when withdrawing more than vault + account balance", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // // Move 1 share into account
        // await vault.redeem(1);

        // await expect(
        //   vault.initiateWithdraw(depositAmount.add(1))
        // ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when initiating with past existing withdrawal", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await vault.initiateWithdraw(depositAmount.div(2));

        // await setOpynOracleExpiryPrice(
        //   params.asset,
        //   oracle,
        //   await getCurrentOptionExpiry(),
        //   firstOptionStrike
        // );
        // await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);
        // await vault.connect(ownerSigner).commitAndClose();
        // await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        // await vault.connect(keeperSigner).rollToNextOption();

        // await expect(
        //   vault.initiateWithdraw(depositAmount.div(2))
        // ).to.be.revertedWith("Existing withdraw");
      });

      it("creates withdrawal from unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // const tx = await vault.initiateWithdraw(depositAmount);

        // await expect(tx)
        //   .to.emit(vault, "InitiateWithdraw")
        //   .withArgs(user, depositAmount, 2);

        // await expect(tx)
        //   .to.emit(vault, "Transfer")
        //   .withArgs(vault.address, user, depositAmount);

        // const { round, shares } = await vault.withdrawals(user);
        // assert.equal(round, 2);
        // assert.bnEqual(shares, depositAmount);
      });

      it("creates withdrawal by debiting user shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await vault.redeem(depositAmount.div(2));

        // const tx = await vault.initiateWithdraw(depositAmount);

        // await expect(tx)
        //   .to.emit(vault, "InitiateWithdraw")
        //   .withArgs(user, depositAmount, 2);

        // // First we redeem the leftover amount
        // await expect(tx)
        //   .to.emit(vault, "Transfer")
        //   .withArgs(vault.address, user, depositAmount.div(2));

        // // Then we debit the shares from the user
        // await expect(tx)
        //   .to.emit(vault, "Transfer")
        //   .withArgs(user, vault.address, depositAmount);

        // assert.bnEqual(await vault.balanceOf(user), BigNumber.from(0));
        // assert.bnEqual(await vault.balanceOf(vault.address), depositAmount);

        // const { round, shares } = await vault.withdrawals(user);
        // assert.equal(round, 2);
        // assert.bnEqual(shares, depositAmount);
      });

      it("tops up existing withdrawal", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // const tx1 = await vault.initiateWithdraw(depositAmount.div(2));
        // // We redeem the full amount on the first initiateWithdraw
        // await expect(tx1)
        //   .to.emit(vault, "Transfer")
        //   .withArgs(vault.address, user, depositAmount);
        // await expect(tx1)
        //   .to.emit(vault, "Transfer")
        //   .withArgs(user, vault.address, depositAmount.div(2));

        // const tx2 = await vault.initiateWithdraw(depositAmount.div(2));
        // await expect(tx2)
        //   .to.emit(vault, "Transfer")
        //   .withArgs(user, vault.address, depositAmount.div(2));

        // const { round, shares } = await vault.withdrawals(user);
        // assert.equal(round, 2);
        // assert.bnEqual(shares, depositAmount);
      });

      it("reverts when there is insufficient balance over multiple calls", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // await vault.initiateWithdraw(depositAmount.div(2));

        // await expect(
        //   vault.initiateWithdraw(depositAmount.div(2).add(1))
        // ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // const tx = await vault.initiateWithdraw(depositAmount);
        // const receipt = await tx.wait();
        // assert.isAtMost(receipt.gasUsed.toNumber(), 105000);
        // console.log("initiateWithdraw", receipt.gasUsed.toNumber());
      });
    });

    describe("#completeWithdraw", () => {
      time.revertToSnapshotAfterEach(async () => {
        // await assetContract
        //   .connect(userSigner)
        //   .approve(vault.address, depositAmount);
        // await vault.deposit(depositAmount);

        // await assetContract.connect(userSigner).transfer(owner, depositAmount);
        // await assetContract
        //   .connect(ownerSigner)
        //   .approve(vault.address, depositAmount);
        // await vault.connect(ownerSigner).deposit(depositAmount);

        // await rollToNextOption();

        // await vault.initiateWithdraw(depositAmount);
      });

      it.skip("reverts when not initiated", async function () {
        await expect(
          vault.connect(ownerSigner).completeWithdraw()
        ).to.be.revertedWith("Not initiated");
      });

      it("reverts when round not closed", async function () {
        await expect(vault.completeWithdraw()).to.be.revertedWith(
          "Not initiated"
        );
      });

      // it("reverts when calling completeWithdraw twice", async function () {
      //   await rollToSecondOption(firstOptionStrike);

      //   await vault.completeWithdraw();

      //   await expect(vault.completeWithdraw()).to.be.revertedWith(
      //     "Not initiated"
      //   );
      // });

      // it("completes the withdrawal", async function () {
      //   const firstStrikePrice = firstOptionStrike;
      //   const settlePriceITM = isPut
      //     ? firstStrikePrice.sub(100000000)
      //     : firstStrikePrice.add(100000000);

      //   await rollToSecondOption(settlePriceITM);

      //   const pricePerShare = await vault.roundPricePerShare(2);
      //   const withdrawAmount = depositAmount
      //     .mul(pricePerShare)
      //     .div(BigNumber.from(10).pow(await vault.decimals()));
      //   const lastQueuedWithdrawAmount = await vault.lastQueuedWithdrawAmount();

      //   let beforeBalance: BigNumber;
      //   if (collateralAsset === WETH_ADDRESS[chainId]) {
      //     beforeBalance = await provider.getBalance(user);
      //   } else {
      //     beforeBalance = await assetContract.balanceOf(user);
      //   }

      //   const { queuedWithdrawShares: startQueuedShares } =
      //     await vault.vaultState();

      //   const tx = await vault.completeWithdraw({ gasPrice });
      //   const receipt = await tx.wait();
      //   const gasFee = receipt.gasUsed.mul(gasPrice);

      //   await expect(tx)
      //     .to.emit(vault, "Withdraw")
      //     .withArgs(user, withdrawAmount.toString(), depositAmount);

      //   if (collateralAsset !== WETH_ADDRESS[chainId]) {
      //     const collateralERC20 = await getContractAt(
      //       "IERC20",
      //       collateralAsset
      //     );

      //     await expect(tx)
      //       .to.emit(collateralERC20, "Transfer")
      //       .withArgs(vault.address, user, withdrawAmount);
      //   }

      //   const { shares, round } = await vault.withdrawals(user);
      //   assert.equal(shares, 0);
      //   assert.equal(round, 2);

      //   const { queuedWithdrawShares: endQueuedShares } =
      //     await vault.vaultState();

      //   assert.bnEqual(endQueuedShares, BigNumber.from(0));
      //   assert.bnEqual(
      //     await vault.lastQueuedWithdrawAmount(),
      //     lastQueuedWithdrawAmount.sub(withdrawAmount)
      //   );
      //   assert.bnEqual(startQueuedShares.sub(endQueuedShares), depositAmount);

      //   let actualWithdrawAmount: BigNumber;
      //   if (collateralAsset === WETH_ADDRESS[chainId]) {
      //     const afterBalance = await provider.getBalance(user);
      //     actualWithdrawAmount = afterBalance.sub(beforeBalance).add(gasFee);
      //   } else {
      //     const afterBalance = await assetContract.balanceOf(user);
      //     actualWithdrawAmount = afterBalance.sub(beforeBalance);
      //   }
      //   // Should be less because the pps is down
      //   assert.bnLt(actualWithdrawAmount, depositAmount);
      //   assert.bnEqual(actualWithdrawAmount, withdrawAmount);
      // });

      // it("fits gas budget [ @skip-on-coverage ]", async function () {
      //   await rollToSecondOption(firstOption.strikePrice);

      //   const tx = await vault.completeWithdraw({ gasPrice });
      //   const receipt = await tx.wait();

      //   assert.isAtMost(receipt.gasUsed.toNumber(), 100342);
      //   // console.log(
      //   //   params.name,
      //   //   "completeWithdraw",
      //   //   receipt.gasUsed.toNumber()
      //   // );
      // });
    });

    describe("#stake", () => {
      let liquidityGauge: Contract;

      time.revertToSnapshotAfterEach(async () => {
        const MockLiquidityGauge = await getContractFactory(
          "MockLiquidityGauge",
          ownerSigner
        );
        liquidityGauge = await MockLiquidityGauge.deploy(vault.address);
      });

      it("reverts when liquidityGauge is not set", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        // await rollToNextOption();
        // await expect(vault.stake(depositAmount)).to.be.reverted;
      });

      it("reverts when 0 passed", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        // await rollToNextOption();
        // await expect(vault.stake(0)).to.be.reverted;
      });

      it("reverts when staking more than available", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(userSigner).deposit(depositAmount);

        // await rollToNextOption();

        // await expect(
        //   vault.connect(userSigner).stake(depositAmount.add(1))
        // ).to.be.revertedWith("Exceeds available");
      });

      it("reverts when staking more than available after redeeming", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(userSigner).deposit(depositAmount);

        // await rollToNextOption();

        // await vault.connect(userSigner).maxRedeem();

        // await expect(
        //   vault.connect(userSigner).stake(depositAmount.add(1))
        // ).to.be.revertedWith("Exceeds available");
      });

      it("stakes shares", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(userSigner).deposit(depositAmount);

        const userOldBalance = await vault.balanceOf(user);

        // await rollToNextOption();

        // const stakeAmount = BigNumber.from(1);
        // const tx1 = await vault.connect(userSigner).stake(stakeAmount);

        // await expect(tx1)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, stakeAmount, 1);

        // assert.bnEqual(await liquidityGauge.balanceOf(user), stakeAmount);
        // assert.bnEqual(
        //   await vault.balanceOf(liquidityGauge.address),
        //   stakeAmount
        // );
        // assert.bnEqual(await vault.balanceOf(user), userOldBalance);

        // const {
        //   round: round1,
        //   amount: amount1,
        //   unredeemedShares: unredeemedShares1,
        // } = await vault.depositReceipts(user);

        // assert.equal(round1, 1);
        // assert.bnEqual(amount1, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares1, depositAmount.sub(stakeAmount));

        // const tx2 = await vault
        //   .connect(userSigner)
        //   .stake(depositAmount.sub(stakeAmount));

        // await expect(tx2)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, depositAmount.sub(stakeAmount), 1);

        // assert.bnEqual(await liquidityGauge.balanceOf(user), depositAmount);
        // assert.bnEqual(
        //   await vault.balanceOf(liquidityGauge.address),
        //   depositAmount
        // );
        // assert.bnEqual(await vault.balanceOf(user), userOldBalance);

        // const {
        //   round: round2,
        //   amount: amount2,
        //   unredeemedShares: unredeemedShares2,
        // } = await vault.depositReceipts(user);

        // assert.equal(round2, 1);
        // assert.bnEqual(amount2, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares2, BigNumber.from(0));
      });

      it("stakes shares after redeeming", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(userSigner).deposit(depositAmount);

        const userOldBalance = await vault.balanceOf(user);

        // await rollToNextOption();

        // const stakeAmount = depositAmount.div(2);
        // const redeemAmount = depositAmount.div(3);

        // await vault.connect(userSigner).redeem(redeemAmount);
        // const tx1 = await vault.connect(userSigner).stake(stakeAmount);

        // await expect(tx1)
        //   .to.emit(vault, "Redeem")
        //   .withArgs(user, stakeAmount.sub(redeemAmount), 1);

        // assert.bnEqual(await liquidityGauge.balanceOf(user), stakeAmount);
        // assert.bnEqual(
        //   await vault.balanceOf(liquidityGauge.address),
        //   stakeAmount
        // );
        // assert.bnEqual(await vault.balanceOf(user), userOldBalance);

        // const {
        //   round: round1,
        //   amount: amount1,
        //   unredeemedShares: unredeemedShares1,
        // } = await vault.depositReceipts(user);

        // assert.equal(round1, 1);
        // assert.bnEqual(amount1, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares1, depositAmount.sub(stakeAmount));

        // await vault.connect(userSigner).maxRedeem();
        // await vault.connect(userSigner).stake(depositAmount.sub(stakeAmount));

        // assert.bnEqual(await liquidityGauge.balanceOf(user), depositAmount);
        // assert.bnEqual(
        //   await vault.balanceOf(liquidityGauge.address),
        //   depositAmount
        // );
        // assert.bnEqual(await vault.balanceOf(user), userOldBalance);

        // const {
        //   round: round2,
        //   amount: amount2,
        //   unredeemedShares: unredeemedShares2,
        // } = await vault.depositReceipts(user);

        // assert.equal(round2, 1);
        // assert.bnEqual(amount2, BigNumber.from(0));
        // assert.bnEqual(unredeemedShares2, BigNumber.from(0));
      });
    });

    describe("#setCap", () => {
      time.revertToSnapshotAfterEach();

      it("should revert if not owner", async function () {
        await expect(
          vault.connect(userSigner).setCap(parseEther("10"))
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it.skip("should set the new cap", async function () {
        const tx = await vault.connect(ownerSigner).setCap(parseEther("10"));
        assert.equal((await vault.cap()).toString(), parseEther("10"));
        await expect(tx)
          .to.emit(vault, "CapSet")
          .withArgs(
            parseUnits("500", tokenDecimals > 18 ? tokenDecimals : 18),
            parseEther("10")
          );
      });

      it("should revert when depositing over the cap", async function () {
        const capAmount = BigNumber.from("100000000");
        const depositAmount = BigNumber.from("10000000000");
        await vault.connect(ownerSigner).setCap(capAmount);

        await expect(vault.deposit(depositAmount)).to.be.revertedWith(
          "Exceed cap"
        );
      });
    });

    describe("#setLiquidityGauge", () => {
      time.revertToSnapshotAfterEach();

      it("should revert if not owner", async function () {
        await expect(
          vault.connect(userSigner).setLiquidityGauge(constants.AddressZero)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should set the new liquidityGauge", async function () {
        const MockLiquidityGauge = await getContractFactory(
          "MockLiquidityGauge",
          ownerSigner
        );
        const liquidityGauge = await MockLiquidityGauge.deploy(vault.address);
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);
        assert.equal(await vault.liquidityGauge(), liquidityGauge.address);
      });

      it("should remove liquidityGauge", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(constants.AddressZero);
        assert.equal(await vault.liquidityGauge(), constants.AddressZero);
      });
    });

    describe("#shares", () => {
      time.revertToSnapshotAfterEach();

      it("shows correct share balance after redemptions", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // assert.bnEqual(await vault.shares(user), depositAmount);

        // const redeemAmount = BigNumber.from(1);
        // await vault.redeem(redeemAmount);

        // // Share balance should remain the same because the 1 share
        // // is transferred to the user
        // assert.bnEqual(await vault.shares(user), depositAmount);

        // await vault.transfer(owner, redeemAmount);

        // assert.bnEqual(
        //   await vault.shares(user),
        //   depositAmount.sub(redeemAmount)
        // );
        // assert.bnEqual(await vault.shares(owner), redeemAmount);
      });
    });

    describe("#shareBalances", () => {
      time.revertToSnapshotAfterEach();

      it("returns the share balances split", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // const [heldByAccount1, heldByVault1] = await vault.shareBalances(user);
        // assert.bnEqual(heldByAccount1, BigNumber.from(0));
        // assert.bnEqual(heldByVault1, depositAmount);

        // await vault.redeem(1);
        // const [heldByAccount2, heldByVault2] = await vault.shareBalances(user);
        // assert.bnEqual(heldByAccount2, BigNumber.from(1));
        // assert.bnEqual(heldByVault2, depositAmount.sub(1));
      });
    });

    describe("#shares", () => {
      time.revertToSnapshotAfterEach();

      it("returns the total number of shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        // await rollToNextOption();

        // assert.bnEqual(await vault.shares(user), depositAmount);

        // // Should remain the same after redemption because it's held on balanceOf
        // await vault.redeem(1);
        // assert.bnEqual(await vault.shares(user), depositAmount);
      });
    });

    describe("#accountVaultBalance", () => {
      time.revertToSnapshotAfterEach();

      it("returns a lesser underlying amount for user", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        // await rollToNextOption();

        // assert.bnEqual(
        //   await vault.accountVaultBalance(user),
        //   BigNumber.from(depositAmount)
        // );

        // await assetContract.connect(userSigner).transfer(owner, depositAmount);
        // await assetContract
        //   .connect(ownerSigner)
        //   .approve(vault.address, depositAmount);
        // await vault.connect(ownerSigner).deposit(depositAmount);

        // // remain the same after deposit
        // assert.bnEqual(
        //   await vault.accountVaultBalance(user),
        //   BigNumber.from(depositAmount)
        // );

        // const AMOUNT = {
        //   [CHAINID.ETH_MAINNET]: "100000000000",
        //   [CHAINID.AVAX_MAINNET]: "1000000000",
        // };

        // const settlementPriceITM = isPut
        //   ? firstOptionStrike.sub(AMOUNT[chainId])
        //   : firstOptionStrike.add(AMOUNT[chainId]);

        // // console.log(settlementPriceITM.toString());

        // await rollToSecondOption(settlementPriceITM);

        // // Minus 1 due to rounding errors from share price != 1
        // assert.bnLt(
        //   await vault.accountVaultBalance(user),
        //   BigNumber.from(depositAmount)
        // );
      });
    });

    describe("#decimals", () => {
      it("should return 18 for decimals", async function () {
        assert.equal(
          (await vault.decimals()).toString(),
          tokenDecimals.toString()
        );
      });
    });
  });
});
