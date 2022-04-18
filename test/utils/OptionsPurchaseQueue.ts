import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, constants, Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import moment from "moment-timezone";
import * as time from "../helpers/time";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "../helpers/assertions";
const { getContractFactory } = ethers;

moment.tz.setDefault("UTC");

const TOKEN_DECIMALS = 18;
const OPTION_DECIMALS = 8;
const CEILING_PRICE = parseUnits("0.01", TOKEN_DECIMALS);
const HIGHER_SETTLEMENT_PRICE = parseUnits("0.02", TOKEN_DECIMALS);
const LOWER_SETTLEMENT_PRICE = parseUnits("0.005", TOKEN_DECIMALS);
const MIN_PURCHASE_AMOUNT = parseUnits("100", OPTION_DECIMALS);

describe("OptionsPurchaseQueue", () => {
  let initSnapshotId: string;

  // Signers
  let ownerSigner: SignerWithAddress,
    buyer0Signer: SignerWithAddress,
    buyer1Signer: SignerWithAddress;
  // buyer2Signer: SignerWithAddress;

  // Contracts
  let optionsPurchaseQueue: Contract;
  let token: Contract;
  let option: Contract;
  let vault: Contract;

  before(async function () {
    // Reset block
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });

    initSnapshotId = await time.takeSnapshot();

    [
      ownerSigner,
      buyer0Signer,
      buyer1Signer, // buyer2Signer,
    ] = await ethers.getSigners();

    const OptionsPurchaseQueue = await getContractFactory(
      "OptionsPurchaseQueue",
      ownerSigner
    );

    optionsPurchaseQueue = await OptionsPurchaseQueue.deploy();

    const MockERC20 = await getContractFactory("MockERC20", ownerSigner);

    token = await MockERC20.deploy("TOKEN", "TOKEN");

    option = await MockERC20.deploy("OPTION", "OPTION");

    const MockRibbonVault = await getContractFactory(
      "MockRibbonVault",
      ownerSigner
    );

    vault = await MockRibbonVault.deploy();

    await vault.setAsset(token.address);
    await vault.setCurrentOption(option.address);
  });

  after(async () => {
    await time.revertToSnapShot(initSnapshotId);
  });

  describe("#allocateOptions", () => {
    const optionsAmount = MIN_PURCHASE_AMOUNT.mul(10);
    const premiums = optionsAmount
      .mul(CEILING_PRICE)
      .div(BigNumber.from(10).pow(OPTION_DECIMALS));

    time.revertToSnapshotAfterEach(async function () {
      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      // Set min purchase amount
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setMinPurchaseAmount(vault.address, MIN_PURCHASE_AMOUNT);

      // Mint premiums to buyer 0
      await token.connect(ownerSigner).mint(buyer0Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer0Signer)
        .approve(optionsPurchaseQueue.address, premiums);
    });

    it("reverts if caller is not vault", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .allocateOptions(optionsAmount)
      ).to.be.revertedWith("Not vault");
    });

    it("reverts if ceilingPrice is 0", async function () {
      // Set ceiling price to 0
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, BigNumber.from(0));

      await expect(
        vault.allocateOptions(
          optionsPurchaseQueue.address,
          option.address,
          optionsAmount
      )).to.be.revertedWith("Not vault");
    });

    it("reverts when the vault has insufficient token balance", async function () {
      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount.div(2));

      // Buyer 0 makes a purchase request
      await optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, optionsAmount);

      await expect(vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount
      )).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });

    it("allocates the correct options amount", async function () {
      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      // Buyer 0 makes a purchase request
      await optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, optionsAmount);

      const queueBalanceBefore = await option.balanceOf(optionsPurchaseQueue.address);

      const tx = await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount.div(2)
      );

      const queueBalanceAfter = await option.balanceOf(optionsPurchaseQueue.address);

      await expect(tx).to.emit(optionsPurchaseQueue, "OptionsAllocated")
      .withArgs(
        vault.address,
        optionsAmount.div(2)
      );

      assert.bnEqual(
        await optionsPurchaseQueue.vaultAllocatedOptions(vault.address),
        optionsAmount.div(2)
      );
      assert.bnEqual(
        queueBalanceAfter.sub(queueBalanceBefore),
        optionsAmount.div(2)
      );
    });

    it("does not transfer otokens when allocating 0 amount", async function () {
      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      // Buyer 0 makes a purchase request
      await optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, optionsAmount);

      const queueBalanceBefore = await option.balanceOf(optionsPurchaseQueue.address);

      const tx = await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        BigNumber.from(0)
      );

      const queueBalanceAfter = await option.balanceOf(optionsPurchaseQueue.address);

      await expect(tx).to.emit(optionsPurchaseQueue, "OptionsAllocated")
      .withArgs(
        vault.address,
        BigNumber.from(0)
      );

      assert.bnEqual(
        queueBalanceAfter.sub(queueBalanceBefore),
        BigNumber.from(0)
      );
    });

    it("caps options allocation to total request", async function () {
      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      // Buyer 0 makes a purchase request
      await optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, optionsAmount.div(2));

      const queueBalanceBefore = await option.balanceOf(optionsPurchaseQueue.address);

      await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount
      );

      const queueBalanceAfter = await option.balanceOf(optionsPurchaseQueue.address);

      assert.bnEqual(
        await optionsPurchaseQueue.vaultAllocatedOptions(vault.address),
        optionsAmount.div(2)
      );
      assert.bnEqual(
        queueBalanceAfter.sub(queueBalanceBefore),
        optionsAmount.div(2)
      );
    });

    it("adds to current allocated options", async function () {
      const firstAllocationAmount = optionsAmount.mul(1).div(3);

      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      // Buyer 0 makes a purchase request
      await optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, optionsAmount);

      const queueBalanceBeforeFirst = await option.balanceOf(optionsPurchaseQueue.address);

      const tx1 = await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        firstAllocationAmount
      );

      await expect(tx1).to.emit(optionsPurchaseQueue, "OptionsAllocated")
      .withArgs(
        vault.address,
        firstAllocationAmount
      );

      const queueBalanceAfterFirst = await option.balanceOf(optionsPurchaseQueue.address);

      assert.bnEqual(
        await optionsPurchaseQueue.vaultAllocatedOptions(vault.address),
        firstAllocationAmount
      );
      assert.bnEqual(
        queueBalanceAfterFirst.sub(queueBalanceBeforeFirst),
        firstAllocationAmount
      );

      const tx2 = await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount
      );

      await expect(tx2).to.emit(optionsPurchaseQueue, "OptionsAllocated")
      .withArgs(
        vault.address,
        optionsAmount.sub(firstAllocationAmount)
      );

      const queueBalanceAfterSecond = await option.balanceOf(optionsPurchaseQueue.address);

      assert.bnEqual(
        await optionsPurchaseQueue.vaultAllocatedOptions(vault.address),
        optionsAmount
      );
      assert.bnEqual(
        queueBalanceAfterSecond.sub(queueBalanceAfterFirst),
        optionsAmount.sub(firstAllocationAmount)
      );
    });

    it("fits gas budget [ @skip-on-coverage ]", async function () {
      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      // Buyer 0 makes a purchase request
      await optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, optionsAmount.div(2));

      const tx = await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount
      );

      const receipt = await tx.wait();

      assert.isAtMost(receipt.gasUsed.toNumber(), 119071);
      // console.log("allocateOptions", receipt.gasUsed.toNumber());
    });
  });

  describe("#sellToBuyers", () => {
    const optionsAmount = MIN_PURCHASE_AMOUNT.mul(10);
    const premiums = optionsAmount
      .mul(CEILING_PRICE)
      .div(BigNumber.from(10).pow(OPTION_DECIMALS));

    time.revertToSnapshotAfterEach(async function () {
      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      // Set min purchase amount
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setMinPurchaseAmount(vault.address, MIN_PURCHASE_AMOUNT);

      // Mint premiums to buyer 0
      await token.connect(ownerSigner).mint(buyer0Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer0Signer)
        .approve(optionsPurchaseQueue.address, premiums);

      // Mint premiums to buyer 1
      await token.connect(ownerSigner).mint(buyer1Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer1Signer)
        .approve(optionsPurchaseQueue.address, premiums);
    });

    it("reverts if caller is not vault", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .sellToBuyers(LOWER_SETTLEMENT_PRICE)
      ).to.be.revertedWith("Not vault");
    });

    it("reverts if ceilingPrice is 0", async function () {
      // Set ceiling price to 0
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, BigNumber.from(0));

      await expect(
        vault.sellToBuyers(optionsPurchaseQueue.address, LOWER_SETTLEMENT_PRICE)).to.be.revertedWith("Not vault");
    });

    it("clears the purchase queue when settlement is lower than ceiling", async function () {
      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      const buyer0Amount = optionsAmount.mul(1).div(3);
      const buyer1Amount = optionsAmount;
      const expectedBuyer0Refund = buyer0Amount.mul(CEILING_PRICE.sub(LOWER_SETTLEMENT_PRICE)).div(10 ** 8);
      const expectedBuyer1Refund = optionsAmount.mul(CEILING_PRICE).div(10 ** 8)
        .sub((optionsAmount.sub(buyer0Amount)).mul(LOWER_SETTLEMENT_PRICE).div(10 ** 8));

      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, buyer0Amount);

      await optionsPurchaseQueue
        .connect(buyer1Signer)
        .requestPurchase(vault.address, buyer1Amount);

      await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount
      );

      const vaultBalanceBeforeSell = await token.balanceOf(vault.address);
      const buyer0OptionBalanceBeforeSell = await option.balanceOf(buyer0Signer.address);
      const buyer1OptionBalanceBeforeSell = await option.balanceOf(buyer1Signer.address);
      const buyer0TokenBalanceBeforeSell = await token.balanceOf(buyer0Signer.address);
      const buyer1TokenBalanceBeforeSell = await token.balanceOf(buyer1Signer.address);

      const tx = await vault.sellToBuyers(optionsPurchaseQueue.address, LOWER_SETTLEMENT_PRICE);

      const vaultBalanceAfterSell = await token.balanceOf(vault.address);
      const buyer0OptionBalanceAfterSell = await option.balanceOf(buyer0Signer.address);
      const buyer1OptionBalanceAfterSell = await option.balanceOf(buyer1Signer.address);
      const buyer0TokenBalanceAfterSell = await token.balanceOf(buyer0Signer.address);
      const buyer1TokenBalanceAfterSell = await token.balanceOf(buyer1Signer.address);

      assert.bnEqual(
        vaultBalanceAfterSell.sub(vaultBalanceBeforeSell),
        optionsAmount.mul(LOWER_SETTLEMENT_PRICE).div(10 ** 8)
      );
      assert.bnEqual(
        buyer0OptionBalanceAfterSell.sub(buyer0OptionBalanceBeforeSell),
        buyer0Amount
      );
      assert.bnEqual(
        buyer1OptionBalanceAfterSell.sub(buyer1OptionBalanceBeforeSell),
        optionsAmount.sub(buyer0Amount)
      );
      assert.bnEqual(
        buyer0TokenBalanceAfterSell.sub(buyer0TokenBalanceBeforeSell),
        BigNumber.from(expectedBuyer0Refund)
      );
      assert.bnEqual(
        buyer1TokenBalanceAfterSell.sub(buyer1TokenBalanceBeforeSell),
        BigNumber.from(expectedBuyer1Refund)
      );

      await expect(tx).to.emit(optionsPurchaseQueue, 'OptionsSold').withArgs(
          vault.address,
          optionsAmount.mul(LOWER_SETTLEMENT_PRICE).div(10 ** 8),
          optionsAmount
      );
    });

    it("clears the purchase queue when settlement is higher than ceiling", async function () {
      // Mint oTokens to the vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      const buyer0Amount = optionsAmount.mul(1).div(3);
      const buyer1Amount = optionsAmount;
      const expectedBuyer0Prems = buyer0Amount.mul(CEILING_PRICE).div(10 ** 8);
      const expectedBuyer1Prems = buyer1Amount.mul(CEILING_PRICE).div(10 ** 8);

      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, buyer0Amount);

      await optionsPurchaseQueue
        .connect(buyer1Signer)
        .requestPurchase(vault.address, buyer1Amount);

      await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount
      );

      const vaultBalanceBeforeSell = await token.balanceOf(vault.address);
      const buyer0OptionBalanceBeforeSell = await option.balanceOf(buyer0Signer.address);
      const buyer1OptionBalanceBeforeSell = await option.balanceOf(buyer1Signer.address);
      const buyer0TokenBalanceBeforeSell = await token.balanceOf(buyer0Signer.address);
      const buyer1TokenBalanceBeforeSell = await token.balanceOf(buyer1Signer.address);

      const tx = await vault.sellToBuyers(optionsPurchaseQueue.address, HIGHER_SETTLEMENT_PRICE);

      const vaultBalanceAfterSell = await token.balanceOf(vault.address);
      const buyer0OptionBalanceAfterSell = await option.balanceOf(buyer0Signer.address);
      const buyer1OptionBalanceAfterSell = await option.balanceOf(buyer1Signer.address);
      const buyer0TokenBalanceAfterSell = await token.balanceOf(buyer0Signer.address);
      const buyer1TokenBalanceAfterSell = await token.balanceOf(buyer1Signer.address);

      assert.bnEqual(
        vaultBalanceAfterSell.sub(vaultBalanceBeforeSell),
        expectedBuyer0Prems.add(expectedBuyer1Prems),
      );
      assert.bnEqual(
        buyer0OptionBalanceAfterSell.sub(buyer0OptionBalanceBeforeSell),
        buyer0Amount
      );
      assert.bnEqual(
        buyer1OptionBalanceAfterSell.sub(buyer1OptionBalanceBeforeSell),
        optionsAmount.sub(buyer0Amount)
      );
      assert.bnEqual(
        buyer0TokenBalanceAfterSell.sub(buyer0TokenBalanceBeforeSell),
        BigNumber.from(0)
      );
      assert.bnEqual(
        buyer1TokenBalanceAfterSell.sub(buyer1TokenBalanceBeforeSell),
        BigNumber.from(0)
      );

      await expect(tx).to.emit(optionsPurchaseQueue, 'OptionsSold').withArgs(
          vault.address,
          expectedBuyer0Prems.add(expectedBuyer1Prems),
          optionsAmount
      );
    });

    it("fits gas budget [ @skip-on-coverage ]", async function () {
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);

      const buyer0Amount = optionsAmount;

      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, buyer0Amount);

      await vault.allocateOptions(
        optionsPurchaseQueue.address,
        option.address,
        optionsAmount
      );

      const tx = await vault.sellToBuyers(optionsPurchaseQueue.address, LOWER_SETTLEMENT_PRICE);

      const receipt = await tx.wait();

      assert.isAtMost(receipt.gasUsed.toNumber(), 130095);
      // console.log("sellToBuyers", receipt.gasUsed.toNumber());
    });
  });

  describe("#requestPurchase", () => {
    const optionsAmount = MIN_PURCHASE_AMOUNT.mul(10);
    const premiums = optionsAmount
      .mul(CEILING_PRICE)
      .div(BigNumber.from(10).pow(OPTION_DECIMALS));

    time.revertToSnapshotAfterEach(async function () {
      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      // Set min purchase amount
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setMinPurchaseAmount(vault.address, MIN_PURCHASE_AMOUNT);

      // Mint premiums to buyer 0
      await token.connect(ownerSigner).mint(buyer0Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer0Signer)
        .approve(optionsPurchaseQueue.address, premiums);
    });

    it("reverts if ceilingPrice is 0", async function () {
      // Set ceiling price to 0
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, BigNumber.from(0));

      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, premiums)
      ).to.be.revertedWith("Invalid vault");
    });

    it("reverts if optionsAmount is 0", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, BigNumber.from(0))
      ).to.be.revertedWith("!optionsAmount");
    });

    it("reverts if optionsAmount is less than the minPurchaseAmount", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, MIN_PURCHASE_AMOUNT.sub(1))
      ).to.be.revertedWith("Minimum purchase requirement");
    });

    it("should request purchase than minPurchaseAmount if buyer is whitelisted", async function () {
      const purchaseAmount = MIN_PURCHASE_AMOUNT.sub(1);
      const purchasePremiums = purchaseAmount
        .mul(CEILING_PRICE)
        .div(BigNumber.from(10).pow(OPTION_DECIMALS));

      // Whitelist buyer 0
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .addWhitelist(buyer0Signer.address);

      let tokenBuyer0Balance = await token.balanceOf(buyer0Signer.address);
      let tokenQueueBalance = await token.balanceOf(
        optionsPurchaseQueue.address
      );
      assert.bnEqual(tokenQueueBalance, BigNumber.from(0));

      // Buyer 0 requests purchase
      let tx = await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, purchaseAmount);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "PurchaseRequested")
        .withArgs(
          buyer0Signer.address,
          vault.address,
          purchaseAmount,
          purchasePremiums
        );

      let oldTokenBuyer0Balance = tokenBuyer0Balance;
      tokenBuyer0Balance = await token.balanceOf(buyer0Signer.address);
      tokenQueueBalance = await token.balanceOf(optionsPurchaseQueue.address);
      assert.bnEqual(
        oldTokenBuyer0Balance.sub(tokenBuyer0Balance),
        purchasePremiums
      );
      assert.bnEqual(tokenQueueBalance, purchasePremiums);
    });

    it("reverts if vault has already allocated options", async function () {
      // Buyer 0 requests purchase
      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, optionsAmount);

      // Mint options to vault
      await option.connect(ownerSigner).mint(vault.address, optionsAmount);
      // Vault allocates options to OptionsPurchaseQueue
      await vault
        .connect(ownerSigner)
        .allocateOptions(
          optionsPurchaseQueue.address,
          option.address,
          optionsAmount
        );

      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .requestPurchase(vault.address, optionsAmount)
      ).to.be.revertedWith("Vault allocated");
    });

    it("reverts if buyer doesn't have enough premiums", async function () {
      // Buyer 1 requests purchase
      await expect(
        optionsPurchaseQueue
          .connect(buyer1Signer)
          .requestPurchase(vault.address, optionsAmount)
      ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    });

    it("should request purchases", async function () {
      // 1. Buyer 0 requests purchase
      // 2. Buyer 0 requests purchase
      // 3. Buyer 1 requests purchase

      let tokenBuyer0Balance = await token.balanceOf(buyer0Signer.address);
      let tokenQueueBalance = await token.balanceOf(
        optionsPurchaseQueue.address
      );
      let purchaseQueue = await optionsPurchaseQueue.getPurchases(
        vault.address
      );
      let totalOptionsAmount = await optionsPurchaseQueue.totalOptionsAmount(
        vault.address
      );
      assert.bnEqual(tokenQueueBalance, BigNumber.from(0));
      assert.equal(purchaseQueue.length, 0);
      assert.bnEqual(totalOptionsAmount, BigNumber.from(0));

      // Buyer 0 requests purchase
      let tx = await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, optionsAmount);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "PurchaseRequested")
        .withArgs(buyer0Signer.address, vault.address, optionsAmount, premiums);

      let oldTokenBuyer0Balance = tokenBuyer0Balance;
      tokenBuyer0Balance = await token.balanceOf(buyer0Signer.address);
      tokenQueueBalance = await token.balanceOf(optionsPurchaseQueue.address);
      purchaseQueue = await optionsPurchaseQueue.getPurchases(vault.address);
      totalOptionsAmount = await optionsPurchaseQueue.totalOptionsAmount(
        vault.address
      );
      assert.bnEqual(oldTokenBuyer0Balance.sub(tokenBuyer0Balance), premiums);
      assert.bnEqual(tokenQueueBalance, premiums);
      assert.equal(purchaseQueue.length, 1);
      assert.bnEqual(purchaseQueue[0].optionsAmount, optionsAmount);
      assert.bnEqual(purchaseQueue[0].premiums, premiums);
      assert.equal(purchaseQueue[0].buyer, buyer0Signer.address);
      assert.bnEqual(totalOptionsAmount, optionsAmount);

      // Mint premiums to buyer 0
      await token.connect(ownerSigner).mint(buyer0Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer0Signer)
        .approve(optionsPurchaseQueue.address, premiums);

      tokenBuyer0Balance = await token.balanceOf(buyer0Signer.address);

      // Buyer 0 requests purchase
      tx = await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, optionsAmount);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "PurchaseRequested")
        .withArgs(buyer0Signer.address, vault.address, optionsAmount, premiums);

      oldTokenBuyer0Balance = tokenBuyer0Balance;
      let oldTokenQueueBalance = tokenQueueBalance;
      let oldTotalOptionsAmount = totalOptionsAmount;
      tokenBuyer0Balance = await token.balanceOf(buyer0Signer.address);
      tokenQueueBalance = await token.balanceOf(optionsPurchaseQueue.address);
      purchaseQueue = await optionsPurchaseQueue.getPurchases(vault.address);
      totalOptionsAmount = await optionsPurchaseQueue.totalOptionsAmount(
        vault.address
      );
      assert.bnEqual(oldTokenBuyer0Balance.sub(tokenBuyer0Balance), premiums);
      assert.bnEqual(tokenQueueBalance.sub(oldTokenQueueBalance), premiums);
      assert.equal(purchaseQueue.length, 2);
      assert.bnEqual(purchaseQueue[1].optionsAmount, optionsAmount);
      assert.bnEqual(purchaseQueue[1].premiums, premiums);
      assert.equal(purchaseQueue[1].buyer, buyer0Signer.address);
      assert.bnEqual(
        totalOptionsAmount.sub(oldTotalOptionsAmount),
        optionsAmount
      );

      // Mint premiums to buyer 1
      await token.connect(ownerSigner).mint(buyer1Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer1Signer)
        .approve(optionsPurchaseQueue.address, premiums);

      let tokenBuyer1Balance = await token.balanceOf(buyer1Signer.address);

      // Buyer 1 requests purchase
      tx = await optionsPurchaseQueue
        .connect(buyer1Signer)
        .requestPurchase(vault.address, optionsAmount);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "PurchaseRequested")
        .withArgs(buyer1Signer.address, vault.address, optionsAmount, premiums);

      let oldTokenBuyer1Balance = tokenBuyer1Balance;
      oldTokenQueueBalance = tokenQueueBalance;
      oldTotalOptionsAmount = totalOptionsAmount;
      tokenBuyer1Balance = await token.balanceOf(buyer1Signer.address);
      tokenQueueBalance = await token.balanceOf(optionsPurchaseQueue.address);
      purchaseQueue = await optionsPurchaseQueue.getPurchases(vault.address);
      totalOptionsAmount = await optionsPurchaseQueue.totalOptionsAmount(
        vault.address
      );
      assert.bnEqual(oldTokenBuyer1Balance.sub(tokenBuyer1Balance), premiums);
      assert.bnEqual(tokenQueueBalance.sub(oldTokenQueueBalance), premiums);
      assert.equal(purchaseQueue.length, 3);
      assert.bnEqual(purchaseQueue[2].optionsAmount, optionsAmount);
      assert.bnEqual(purchaseQueue[2].premiums, premiums);
      assert.equal(purchaseQueue[2].buyer, buyer1Signer.address);
      assert.bnEqual(
        totalOptionsAmount.sub(oldTotalOptionsAmount),
        optionsAmount
      );
    });
  });

  describe('#cancelAllPurchases', () => {
    const optionsAmount = MIN_PURCHASE_AMOUNT.mul(10);
    const premiums = optionsAmount
      .mul(CEILING_PRICE)
      .div(BigNumber.from(10).pow(OPTION_DECIMALS));

    time.revertToSnapshotAfterEach(async function () {
      // Set min purchase amount
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setMinPurchaseAmount(vault.address, MIN_PURCHASE_AMOUNT);

      // Mint premiums to buyer 0
      await token.connect(ownerSigner).mint(buyer0Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer0Signer)
        .approve(optionsPurchaseQueue.address, premiums);

      // Mint premiums to buyer 1
      await token.connect(ownerSigner).mint(buyer1Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer1Signer)
        .approve(optionsPurchaseQueue.address, premiums);
    });

    it("should revert if not owner", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .cancelAllPurchases(buyer0Signer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("reverts if ceilingPrice is not 0", async function () {
      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      await expect(
        optionsPurchaseQueue.connect(ownerSigner).cancelAllPurchases(
          vault.address
      )).to.be.revertedWith("Vault listed");
    });

    it("cancels all purchases", async function () {
      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      const queueBalanceBeforePurchase = await token.balanceOf(optionsPurchaseQueue.address);
      const buyer0BalanceBeforePurchase = await token.balanceOf(buyer0Signer.address);
      const buyer1BalanceBeforePurchase = await token.balanceOf(buyer1Signer.address);

      const buyer0Amount = optionsAmount.mul(1).div(3);
      const buyer1Amount = optionsAmount.sub(buyer0Amount);
      const expectedBuyer0Prems = buyer0Amount.mul(CEILING_PRICE).div(10 ** 8);
      const expectedBuyer1Prems = buyer1Amount.mul(CEILING_PRICE).div(10 ** 8);

      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, buyer0Amount);

      await optionsPurchaseQueue
        .connect(buyer1Signer)
        .requestPurchase(vault.address, buyer1Amount);

      const queueBalanceAfterPurchase = await token.balanceOf(optionsPurchaseQueue.address);
      const buyer0BalanceAfterPurchase = await token.balanceOf(buyer0Signer.address);
      const buyer1BalanceAfterPurchase = await token.balanceOf(buyer1Signer.address);

      assert.bnEqual(
        queueBalanceAfterPurchase.sub(queueBalanceBeforePurchase),
        premiums
      );
      assert.bnEqual(
        buyer0BalanceBeforePurchase.sub(buyer0BalanceAfterPurchase),
        expectedBuyer0Prems
      );
      assert.bnEqual(
        buyer1BalanceBeforePurchase.sub(buyer1BalanceAfterPurchase),
        expectedBuyer1Prems
      );

      assert.bnEqual(
        (await optionsPurchaseQueue.getPurchases(vault.address)).length,
        BigNumber.from(2)
      );

      // Set ceiling price to 0
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, BigNumber.from(0));

      const tx = await optionsPurchaseQueue.connect(ownerSigner).cancelAllPurchases(vault.address);

      await expect(tx).to.emit(optionsPurchaseQueue, 'PurchaseCancelled').withArgs(
          buyer0Signer.address,
          vault.address,
          buyer0Amount,
          expectedBuyer0Prems
      );

      await expect(tx).to.emit(optionsPurchaseQueue, 'PurchaseCancelled').withArgs(
        buyer1Signer.address,
        vault.address,
        buyer1Amount,
        expectedBuyer1Prems
      );
    });

    it("fits gas budget [ @skip-on-coverage ]", async function () {
      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      const buyer0Amount = optionsAmount.mul(1).div(3);

      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, buyer0Amount);

      // Set ceiling price to 0
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, BigNumber.from(0));

      const tx = await optionsPurchaseQueue.connect(ownerSigner).cancelAllPurchases(vault.address);

      const receipt = await tx.wait();

      assert.isAtMost(receipt.gasUsed.toNumber(), 63702);
      // console.log("cancelAllPurchases", receipt.gasUsed.toNumber());
    });
  });

  describe("#addWhitelist", () => {
    time.revertToSnapshotAfterEach();

    it("should revert if not owner", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .addWhitelist(buyer0Signer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if buyer is zero address", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(ownerSigner)
          .addWhitelist(constants.AddressZero)
      ).to.be.revertedWith("!buyer");
    });

    it("should whitelist buyer", async function () {
      assert.equal(
        await optionsPurchaseQueue.whitelistedBuyer(buyer0Signer.address),
        false
      );

      let tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .addWhitelist(buyer0Signer.address);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "AddWhitelist")
        .withArgs(buyer0Signer.address);

      assert.equal(
        await optionsPurchaseQueue.whitelistedBuyer(buyer0Signer.address),
        true
      );
    });
  });

  describe("#removeWhitelist", () => {
    time.revertToSnapshotAfterEach();

    it("should revert if not owner", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .removeWhitelist(buyer0Signer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if buyer is zero address", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(ownerSigner)
          .removeWhitelist(constants.AddressZero)
      ).to.be.revertedWith("!buyer");
    });

    it("should blacklist buyer", async function () {
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .addWhitelist(buyer0Signer.address);

      assert.equal(
        await optionsPurchaseQueue.whitelistedBuyer(buyer0Signer.address),
        true
      );

      let tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .removeWhitelist(buyer0Signer.address);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "RemoveWhitelist")
        .withArgs(buyer0Signer.address);

      assert.equal(
        await optionsPurchaseQueue.whitelistedBuyer(buyer0Signer.address),
        false
      );
    });
  });

  describe("#setCeilingPrice", () => {
    time.revertToSnapshotAfterEach();

    it("should revert if not owner", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .setCeilingPrice(vault.address, CEILING_PRICE)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if vault is zero address", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(ownerSigner)
          .setCeilingPrice(constants.AddressZero, CEILING_PRICE)
      ).to.be.revertedWith("!vault");
    });

    it("should set ceiling price", async function () {
      // 1. Set ceiling price
      // 2. Set 0 ceiling price

      assert.bnEqual(
        await optionsPurchaseQueue.ceilingPrice(vault.address),
        BigNumber.from(0)
      );

      // Set ceiling price
      let tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "CeilingPriceUpdated")
        .withArgs(vault.address, CEILING_PRICE);

      assert.bnEqual(
        await optionsPurchaseQueue.ceilingPrice(vault.address),
        CEILING_PRICE
      );

      // Set 0 ceiling price
      tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, BigNumber.from(0));
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "CeilingPriceUpdated")
        .withArgs(vault.address, BigNumber.from(0));

      assert.bnEqual(
        await optionsPurchaseQueue.ceilingPrice(vault.address),
        BigNumber.from(0)
      );
    });
  });

  describe("#setMinPurchaseAmount", () => {
    time.revertToSnapshotAfterEach();

    it("should revert if not owner", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .setMinPurchaseAmount(vault.address, MIN_PURCHASE_AMOUNT)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if vault is zero address", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(ownerSigner)
          .setMinPurchaseAmount(constants.AddressZero, MIN_PURCHASE_AMOUNT)
      ).to.be.revertedWith("!vault");
    });

    it("should set min purchase amount", async function () {
      // 1. Set min purchase amount
      // 2. Set 0 min purchase amount

      assert.bnEqual(
        await optionsPurchaseQueue.minPurchaseAmount(vault.address),
        BigNumber.from(0)
      );

      // Set min purchase amount
      let tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .setMinPurchaseAmount(vault.address, MIN_PURCHASE_AMOUNT);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "MinPurchaseAmountUpdated")
        .withArgs(vault.address, MIN_PURCHASE_AMOUNT);

      assert.bnEqual(
        await optionsPurchaseQueue.minPurchaseAmount(vault.address),
        MIN_PURCHASE_AMOUNT
      );

      // Set 0 min purchase amount
      tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .setMinPurchaseAmount(vault.address, BigNumber.from(0));
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "MinPurchaseAmountUpdated")
        .withArgs(vault.address, BigNumber.from(0));

      assert.bnEqual(
        await optionsPurchaseQueue.minPurchaseAmount(vault.address),
        BigNumber.from(0)
      );
    });
  });

  describe("#getPurchases", () => {
    time.revertToSnapshotAfterEach();

    it("should return empty array if no purchases", async function () {
      const purchaseQueue = await optionsPurchaseQueue.getPurchases(
        vault.address
      );

      assert.equal(purchaseQueue.length, 0);
    });

    it("should return purchases", async function () {
      const optionsAmount = MIN_PURCHASE_AMOUNT;
      const premiums = optionsAmount
        .mul(CEILING_PRICE)
        .div(BigNumber.from(10).pow(OPTION_DECIMALS));

      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      // Mint premiums to buyer 0
      await token.connect(ownerSigner).mint(buyer0Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer0Signer)
        .approve(optionsPurchaseQueue.address, premiums);

      // Buyer 0 requests purchase
      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, optionsAmount);

      const purchaseQueue = await optionsPurchaseQueue.getPurchases(
        vault.address
      );

      assert.equal(purchaseQueue.length, 1);
      assert.bnEqual(purchaseQueue[0].optionsAmount, optionsAmount);
      assert.bnEqual(purchaseQueue[0].premiums, premiums);
      assert.equal(purchaseQueue[0].buyer, buyer0Signer.address);
    });
  });

  describe("#getPremiums", () => {
    const optionsAmount = MIN_PURCHASE_AMOUNT;
    const premiums = optionsAmount
      .mul(CEILING_PRICE)
      .div(BigNumber.from(10).pow(OPTION_DECIMALS));

    time.revertToSnapshotAfterEach(async function () {
      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);
    });

    it("should return 0 if no ceiling price", async function () {
      // Set ceiling price to 0
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, BigNumber.from(0));

      assert.bnEqual(
        await optionsPurchaseQueue.getPremiums(vault.address, optionsAmount),
        BigNumber.from(0)
      );
    });

    it("should return premiums", async function () {
      assert.bnEqual(
        await optionsPurchaseQueue.getPremiums(vault.address, optionsAmount),
        premiums
      );
    });
  });

  describe("#getOptionsAllocation", () => {
    const optionsAmount = MIN_PURCHASE_AMOUNT;

    time.revertToSnapshotAfterTest();

    it("should return 0 if no options", async function () {
      assert.bnEqual(
        await optionsPurchaseQueue.getOptionsAllocation(
          vault.address,
          optionsAmount
        ),
        BigNumber.from(0)
      );
    });

    it("should return options allocation", async function () {
      // 1. Buyer 0 requests purchase
      // 2. Get double/half options allocation
      // 3. Vault allocates 0.5 * totalOptionsAmount[vault] options to OptionsPurchaseQueue
      // 4. Get double/half options allocation
      // 5. Vault allocates 0.5 * totalOptionsAmount[vault] options to OptionsPurchaseQueue
      // 6. Get double/half options allocation

      const premiums = optionsAmount
        .mul(CEILING_PRICE)
        .div(BigNumber.from(10).pow(OPTION_DECIMALS));

      // Set ceiling price
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .setCeilingPrice(vault.address, CEILING_PRICE);

      // Mint premiums to buyer 0
      await token.connect(ownerSigner).mint(buyer0Signer.address, premiums);
      // Approve premiums to OptionsPurchaseQueue
      await token
        .connect(buyer0Signer)
        .approve(optionsPurchaseQueue.address, premiums);

      // Buyer 0 requests purchase
      await optionsPurchaseQueue
        .connect(buyer0Signer)
        .requestPurchase(vault.address, optionsAmount);

      // Get options allocation with 2 * totalOptionsAmount[vault]
      const doubleAllocatedOptions = optionsAmount.mul(2);
      assert.bnEqual(
        await optionsPurchaseQueue.getOptionsAllocation(
          vault.address,
          doubleAllocatedOptions
        ),
        optionsAmount
      );

      // Get options allocation with 0.5 * totalOptionsAmount[vault]
      const halfAllocatedOptions = optionsAmount.div(2);
      assert.bnEqual(
        await optionsPurchaseQueue.getOptionsAllocation(
          vault.address,
          halfAllocatedOptions
        ),
        halfAllocatedOptions
      );

      // Mint options to vault
      await option
        .connect(ownerSigner)
        .mint(vault.address, halfAllocatedOptions);
      // Vault allocates 0.5 * totalOptionsAmount[vault] options to OptionsPurchaseQueue
      await vault
        .connect(ownerSigner)
        .allocateOptions(
          optionsPurchaseQueue.address,
          option.address,
          halfAllocatedOptions
        );

      // Get options allocation with 2 * totalOptionsAmount[vault]
      assert.bnEqual(
        await optionsPurchaseQueue.getOptionsAllocation(
          vault.address,
          doubleAllocatedOptions
        ),
        halfAllocatedOptions
      );

      // Get options allocation with 0.5 * totalOptionsAmount[vault]
      assert.bnEqual(
        await optionsPurchaseQueue.getOptionsAllocation(
          vault.address,
          halfAllocatedOptions
        ),
        halfAllocatedOptions
      );

      // Mint options to vault
      await option
        .connect(ownerSigner)
        .mint(vault.address, halfAllocatedOptions);
      // Vault allocates 0.5 * totalOptionsAmount[vault] options to OptionsPurchaseQueue
      await vault
        .connect(ownerSigner)
        .allocateOptions(
          optionsPurchaseQueue.address,
          option.address,
          halfAllocatedOptions
        );

      // Get options allocation with 2 * totalOptionsAmount[vault]
      assert.bnEqual(
        await optionsPurchaseQueue.getOptionsAllocation(
          vault.address,
          doubleAllocatedOptions
        ),
        BigNumber.from(0)
      );

      // Get options allocation with 0.5 * totalOptionsAmount[vault]
      assert.bnEqual(
        await optionsPurchaseQueue.getOptionsAllocation(
          vault.address,
          halfAllocatedOptions
        ),
        BigNumber.from(0)
      );
    });
  });
});
