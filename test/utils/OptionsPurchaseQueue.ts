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
// const LOWER_SETTLEMENT_PRICE = parseUnits("0.005", TOKEN_DECIMALS);
// const UPPER_SETTLEMENT_PRICE = parseUnits("0.02", TOKEN_DECIMALS);
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
        .whitelistBuyer(buyer0Signer.address);

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

  describe("#whitelistBuyer", () => {
    time.revertToSnapshotAfterEach();

    it("should revert if not owner", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .whitelistBuyer(buyer0Signer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if buyer is zero address", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(ownerSigner)
          .whitelistBuyer(constants.AddressZero)
      ).to.be.revertedWith("!buyer");
    });

    it("should whitelist buyer", async function () {
      assert.equal(
        await optionsPurchaseQueue.whitelistedBuyer(buyer0Signer.address),
        false
      );

      let tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .whitelistBuyer(buyer0Signer.address);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "BuyerWhitelisted")
        .withArgs(buyer0Signer.address);

      assert.equal(
        await optionsPurchaseQueue.whitelistedBuyer(buyer0Signer.address),
        true
      );
    });
  });

  describe("#blacklistBuyer", () => {
    time.revertToSnapshotAfterEach();

    it("should revert if not owner", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(buyer0Signer)
          .blacklistBuyer(buyer0Signer.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if buyer is zero address", async function () {
      await expect(
        optionsPurchaseQueue
          .connect(ownerSigner)
          .blacklistBuyer(constants.AddressZero)
      ).to.be.revertedWith("!buyer");
    });

    it("should blacklist buyer", async function () {
      await optionsPurchaseQueue
        .connect(ownerSigner)
        .whitelistBuyer(buyer0Signer.address);

      assert.equal(
        await optionsPurchaseQueue.whitelistedBuyer(buyer0Signer.address),
        true
      );

      let tx = await optionsPurchaseQueue
        .connect(ownerSigner)
        .blacklistBuyer(buyer0Signer.address);
      await expect(tx)
        .to.emit(optionsPurchaseQueue, "BuyerBlacklisted")
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
