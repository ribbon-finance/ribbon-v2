import { ethers, network } from "hardhat";
import { expect } from "chai";
import { assert } from "../helpers/assertions";
import { BigNumber, constants, Contract } from "ethers";
import { parseEther, parseUnits } from "ethers/lib/utils";
import { TEST_URI } from "../../scripts/helpers/getDefaultEthersProvider";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import * as time from "../helpers/time";
import { mintToken } from "../helpers/utils";
import {
  BLOCK_NUMBER,
  USDC_ADDRESS,
  USDC_OWNER_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/constants";
const { getContractAt, getContractFactory } = ethers;
const chainId = network.config.chainId;

describe("Swap", () => {
  let initSnapshotId: string;
  let userSigner: SignerWithAddress,
    ownerSigner: SignerWithAddress,
    keeperSigner: SignerWithAddress,
    feeRecipientSigner: SignerWithAddress;

  let owner: string, keeper: string, user: string, feeRecipient: string;
  let swap: Contract;
  let usdcAddress: string;
  let wethAddress: string;

  let wethContract: Contract;
  let usdcContract: Contract;
  let domain: Object;

  // SETUP GET SIGNATURE METHOD
  const types = {
    Bid: [
      { name: "swapId", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "signerWallet", type: "address" },
      { name: "sellAmount", type: "uint256" },
      { name: "buyAmount", type: "uint256" },
      { name: "referrer", type: "address" },
    ],
  };

  const getSignature = async (
    domain: Object,
    order: Object,
    signer: SignerWithAddress
  ) => {
    /* eslint no-underscore-dangle: 0 */
    const signedMsg = await signer._signTypedData(domain, types, order);

    const signature = signedMsg.substring(2);
    const v = parseInt(signature.substring(128, 130), 16);
    const r = "0x" + signature.substring(0, 64);
    const s = "0x" + signature.substring(64, 128);

    return {
      v,
      r,
      s,
    };
  };

  before(async function () {
    // RESET BLOCK
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

    // TAKE SNAPSHOT ID TO REVERT TO
    initSnapshotId = await time.takeSnapshot();

    // GET ACCOUNTS
    [ownerSigner, keeperSigner, userSigner, feeRecipientSigner] =
      await ethers.getSigners();
    owner = ownerSigner.address;
    keeper = keeperSigner.address;
    user = userSigner.address;
    feeRecipient = feeRecipientSigner.address;

    // DEPLOY SWAP CONTRACT
    const Swap = await getContractFactory("Swap", ownerSigner);

    swap = await Swap.connect(ownerSigner).deploy();

    // SETUP DOMAIN
    domain = {
      name: "RIBBON SWAP",
      version: "1",
      chainId,
      verifyingContract: swap.address,
    };

    // MINT USDC FOR USER & OWNER AND GIVE ALLOWANCE TO SWAP CONTRACT
    usdcAddress = USDC_ADDRESS[chainId];
    usdcContract = await getContractAt("IERC20", usdcAddress);
    const usdcOwner = USDC_OWNER_ADDRESS[chainId];

    await mintToken(
      usdcContract, // token contract
      usdcOwner, // token owner
      user, // recipient
      swap.address, // spender
      parseUnits("10000000", 6) // amount
    );

    await usdcContract
      .connect(userSigner)
      .approve(swap.address, parseUnits("10000000", 6));

    await mintToken(
      usdcContract, // token contract
      usdcOwner, // token owner
      owner, // recipient
      swap.address, // spender
      parseUnits("10000000", 6) // amount
    );

    await usdcContract
      .connect(ownerSigner)
      .approve(swap.address, parseUnits("10000000", 6));

    // MINT WETH FOR KEEPER AND GIVE ALLOWANCE TO SWAP CONTRACT
    wethAddress = WETH_ADDRESS[chainId];
    wethContract = await getContractAt("IWETH", wethAddress);

    await wethContract
      .connect(keeperSigner)
      .deposit({ value: parseEther("100") });

    await wethContract
      .connect(keeperSigner)
      .approve(swap.address, parseEther("100"));
  });

  after(async () => {
    await time.revertToSnapShot(initSnapshotId);
  });

  describe("#setFee", () => {
    time.revertToSnapshotAfterTest();

    it("reverts when not owner call", async function () {
      await expect(
        swap.connect(keeperSigner).setFee(keeper, "10")
      ).to.be.revertedWith("caller is not the owner");
    });

    it("reverts when fee more than 100%", async function () {
      await expect(swap.setFee(keeper, 100000)).to.be.revertedWith(
        "Fee exceeds maximum"
      );
    });

    it("sets the correct fee", async function () {
      assert.bnEqual(await swap.referralFees(keeper), BigNumber.from(0));
      await swap.setFee(keeper, "10");
      assert.bnEqual(await swap.referralFees(keeper), BigNumber.from(10));
    });
  });

  describe("#createOffer", () => {
    time.revertToSnapshotAfterTest();

    it("reverts when offeredToken is zero address", async function () {
      await expect(
        swap
          .connect(keeperSigner)
          .createOffer(
            constants.AddressZero,
            usdcAddress,
            parseUnits("3", 6),
            parseUnits("0.01", 8),
            parseEther("1")
          )
      ).to.be.revertedWith("oToken cannot be the zero address");
    });

    it("reverts when biddingToken is zero address", async function () {
      await expect(
        swap
          .connect(keeperSigner)
          .createOffer(
            wethAddress,
            constants.AddressZero,
            parseUnits("3", 6),
            parseUnits("0.01", 8),
            parseEther("1")
          )
      ).to.be.revertedWith("BiddingToken cannot be the zero address");
    });

    it("reverts when min price is zero", async function () {
      await expect(
        swap
          .connect(keeperSigner)
          .createOffer(
            wethAddress,
            usdcAddress,
            0,
            parseUnits("0.01", 8),
            parseEther("1")
          )
      ).to.be.revertedWith("MinPrice must be larger than zero");
    });

    it("reverts when min bid size is zero", async function () {
      await expect(
        swap
          .connect(keeperSigner)
          .createOffer(
            wethAddress,
            usdcAddress,
            parseUnits("3", 6),
            0,
            parseUnits("1", 6)
          )
      ).to.be.revertedWith("MinBidSize must be larger than zero");
    });

    it("reverts when total size is zero", async function () {
      await expect(
        swap
          .connect(keeperSigner)
          .createOffer(
            wethAddress,
            usdcAddress,
            parseUnits("3", 6),
            parseUnits("0.01", 8),
            0
          )
      ).to.be.revertedWith("MinBidSize exceeds total size");
    });

    it("reverts when min bid size is larger than total size", async function () {
      await expect(
        swap
          .connect(keeperSigner)
          .createOffer(
            wethAddress,
            usdcAddress,
            parseUnits("3", 6),
            parseUnits("1.01", 8),
            parseUnits("1", 8)
          )
      ).to.be.revertedWith("MinBidSize exceeds total size");
    });

    it("create offering with the correct parameters", async function () {
      const swapId = (await swap.offersCounter()).add(1);

      await expect(
        await swap
          .connect(keeperSigner)
          .createOffer(
            wethAddress,
            usdcAddress,
            parseUnits("3", 6),
            parseUnits("0.01", 8),
            parseEther("1")
          )
      )
        .to.emit(swap, "NewOffer")
        .withArgs(
          swapId,
          keeper,
          wethAddress,
          usdcAddress,
          parseUnits("3", 6),
          parseUnits("0.01", 8),
          parseEther("1")
        );
    });

    it("fits gas budget [ @skip-on-coverage ]", async function () {
      const tx = await swap
        .connect(keeperSigner)
        .createOffer(
          wethAddress,
          usdcAddress,
          parseUnits("3", 6),
          parseUnits("0.01", 8),
          parseEther("1")
        );

      const receipt = await tx.wait();
      // console.log(receipt.gasUsed.toNumber())
      assert.isAtMost(receipt.gasUsed.toNumber(), 142242);
    });
  });

  describe("#settleOffer", () => {
    const minPrice = parseUnits("3", 6);
    const minBidSize = parseUnits("0.01", 8);
    const totalSize = parseUnits("1", 8);
    let swapId: number;

    time.revertToSnapshotAfterEach(async function () {
      swapId = (await swap.offersCounter()).add(1);

      await swap.connect(userSigner).authorize(owner);

      await swap
        .connect(keeperSigner)
        .createOffer(wethAddress, usdcAddress, minPrice, minBidSize, totalSize);
    });

    it("reverts when Only seller can settle or offer doesn't exist", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(2);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          keeper,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(swap.settleOffer(2, bids)).to.be.revertedWith(
        "Only seller can settle or offer doesn't exist"
      );
    });

    it("reverts when not seller call", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(2);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          keeper,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(swap.settleOffer(swapId, bids)).to.be.revertedWith(
        "Only seller can settle"
      );
    });

    it("reverts when offer is already closed", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await swap.connect(keeperSigner).settleOffer(swapId, bids);

      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("Only seller can settle or offer doesn't exist");
    });

    it("reverts when bid signature is invalid", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(2);
      const referrer = constants.AddressZero;

      const bids = [
        [
          swapId,
          nonce,
          keeper,
          sellAmount,
          buyAmount,
          referrer,
          "0",
          constants.HashZero,
          constants.HashZero,
        ],
      ];

      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("SIGNATURE_INVALID");
    });

    it("reverts when bid signature is mismatched", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(2);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          keeper,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("UNAUTHORIZED");
    });

    it("reverts when signer is not authorized", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(2);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, keeperSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("UNAUTHORIZED");
    });

    it("reverts when nonce already used", async function () {
      const nonce = 1;
      const sellAmount = totalSize.div(2).mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(2);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);
      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("NONCE_ALREADY_USED");
    });

    it("reverts when available size is zero", async function () {
      let nonce = 1;
      let bids = [];

      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = constants.AddressZero;

      for (let i = 0; i < 2; i++) {
        const order = {
          swapId,
          nonce,
          signerWallet: userSigner.address,
          sellAmount,
          buyAmount,
          referrer,
        };

        const signature = await getSignature(domain, order, userSigner);

        bids.push([
          swapId,
          nonce,
          userSigner.address,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ]);

        nonce += 1;
      }
      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("BID_EXCEED_AVAILABLE_SIZE");
    });

    it("reverts when bid size is below minimum", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = minBidSize.sub(1);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("BID_TOO_SMALL");
    });

    it("reverts when price is below minimum", async function () {
      const nonce = 1;
      const sellAmount = totalSize
        .mul(minPrice.sub(10))
        .div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(
        swap.connect(keeperSigner).settleOffer(swapId, bids)
      ).to.be.revertedWith("PRICE_TOO_LOW");
    });

    it("swaps the correct amount", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = constants.AddressZero;

      const userStartUsdcBalance = await usdcContract.balanceOf(user);
      const userStartWethBalance = await wethContract.balanceOf(user);
      const keeperStartUsdcBalance = await usdcContract.balanceOf(keeper);
      const keeperStartWethBalance = await wethContract.balanceOf(keeper);

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(swap.connect(keeperSigner).settleOffer(swapId, bids))
        .to.emit(swap, "Swap")
        .withArgs(swapId, nonce, user, sellAmount, buyAmount, referrer, 0);

      const userEndUsdcBalance = await usdcContract.balanceOf(user);
      const userEndWethBalance = await wethContract.balanceOf(user);
      const keeperEndUsdcBalance = await usdcContract.balanceOf(keeper);
      const keeperEndWethBalance = await wethContract.balanceOf(keeper);

      assert.bnEqual(
        buyAmount,
        keeperStartWethBalance.sub(keeperEndWethBalance)
      );

      assert.bnEqual(buyAmount, userEndWethBalance.sub(userStartWethBalance));

      assert.bnEqual(
        sellAmount,
        keeperEndUsdcBalance.sub(keeperStartUsdcBalance)
      );

      assert.bnEqual(sellAmount, userStartUsdcBalance.sub(userEndUsdcBalance));
    });

    it("allow authorized signer", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, ownerSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await expect(swap.connect(keeperSigner).settleOffer(swapId, bids))
        .to.emit(swap, "Swap")
        .withArgs(swapId, nonce, user, sellAmount, buyAmount, referrer, 0);
    });

    it("gives the correct amount to the referrer", async function () {
      const nonce = 1;
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = feeRecipient;
      const fee = 500;

      swap.setFee(feeRecipient, fee);

      const userStartUsdcBalance = await usdcContract.balanceOf(user);
      const userStartWethBalance = await wethContract.balanceOf(user);
      const keeperStartUsdcBalance = await usdcContract.balanceOf(keeper);
      const keeperStartWethBalance = await wethContract.balanceOf(keeper);
      const referrerStartUsdcBalance = await usdcContract.balanceOf(referrer);

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      const feeAmount = sellAmount.mul(fee).div(10000);

      await expect(swap.connect(keeperSigner).settleOffer(swapId, bids))
        .to.emit(swap, "Swap")
        .withArgs(
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          feeAmount
        );

      const userEndUsdcBalance = await usdcContract.balanceOf(user);
      const userEndWethBalance = await wethContract.balanceOf(user);
      const keeperEndUsdcBalance = await usdcContract.balanceOf(keeper);
      const keeperEndWethBalance = await wethContract.balanceOf(keeper);
      const referrerEndUsdcBalance = await usdcContract.balanceOf(referrer);

      assert.bnEqual(
        buyAmount,
        keeperStartWethBalance.sub(keeperEndWethBalance)
      );

      assert.bnEqual(buyAmount, userEndWethBalance.sub(userStartWethBalance));

      assert.bnEqual(
        sellAmount.sub(feeAmount),
        keeperEndUsdcBalance.sub(keeperStartUsdcBalance)
      );

      assert.bnEqual(sellAmount, userStartUsdcBalance.sub(userEndUsdcBalance));

      assert.bnEqual(
        feeAmount,
        referrerEndUsdcBalance.sub(referrerStartUsdcBalance)
      );
    });

    it("fits gas budget (single) [ @skip-on-coverage ]", async function () {
      const nonce = 1;

      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      const tx = await swap.connect(keeperSigner).settleOffer(swapId, bids);
      const receipt = await tx.wait();
      // console.log(receipt.gasUsed.toNumber())
      assert.isAtMost(receipt.gasUsed.toNumber(), 151600);
    });

    it("fits gas budget (multi) [ @skip-on-coverage ]", async function () {
      let nonce = 1;
      let bids = [];
      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(10);
      const referrer = constants.AddressZero;

      for (let i = 0; i < 10; i++) {
        const order = {
          swapId,
          nonce,
          signerWallet: user,
          sellAmount,
          buyAmount,
          referrer,
        };

        const signature = await getSignature(domain, order, userSigner);

        bids.push([
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ]);

        nonce += 1;
      }
      let tx = await swap.connect(keeperSigner).settleOffer(swapId, bids);
      const receipt = await tx.wait();
      // console.log(receipt.gasUsed.toNumber())
      assert.isAtMost(receipt.gasUsed.toNumber(), 400000);
    });
  });

  describe("#check", () => {
    time.revertToSnapshotAfterEach(async function () {
      await swap.connect(userSigner).authorize(owner);

      await swap
        .connect(keeperSigner)
        .createOffer(
          wethAddress,
          usdcAddress,
          parseUnits("3", 6),
          parseUnits("0.01", 8),
          parseUnits("1", 8)
        );
    });

    it("reverts when offering does not exist", async function () {
      const swapId = 2;
      const nonce = 1;
      const sellAmount = parseUnits("1", 6);
      const buyAmount = parseUnits("1", 8);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      await expect(
        swap.check([
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ])
      ).to.be.revertedWith("Offer does not exist");
    });

    it("returns 0 error when order is valid", async function () {
      const swapId = await swap.offersCounter();
      const nonce = 1;
      const sellAmount = parseUnits("100", 6);
      const buyAmount = parseUnits("0.01", 8);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const error = await swap.check([
        swapId,
        nonce,
        user,
        sellAmount,
        buyAmount,
        referrer,
        signature.v,
        signature.r,
        signature.s,
      ]);

      assert.bnEqual(error[0], BigNumber.from(0));
    });

  it("allow authorized signer to check with 0 error", async function () {
    const swapId = await swap.offersCounter();
    const nonce = 1;
    const sellAmount = parseUnits("100", 6);
    const buyAmount = parseUnits("0.01", 8);
    const referrer = constants.AddressZero;

    const order = {
      swapId,
      nonce,
      signerWallet: user,
      sellAmount,
      buyAmount,
      referrer,
    };

    const signature = await getSignature(domain, order, ownerSigner);

    const error = await swap.check([
      swapId,
      nonce,
      user,
      sellAmount,
      buyAmount,
      referrer,
      signature.v,
      signature.r,
      signature.s,
    ]);

    assert.bnEqual(error[0], BigNumber.from(0));
  });

  it("revert when signer is not authorized", async function () {
    await swap.connect(userSigner).revoke();

    const swapId = await swap.offersCounter();
    const nonce = 1;
    const sellAmount = parseUnits("100", 6);
    const buyAmount = parseUnits("0.01", 8);
    const referrer = constants.AddressZero;

    const order = {
      swapId,
      nonce,
      signerWallet: user,
      sellAmount,
      buyAmount,
      referrer,
    };

    const signature = await getSignature(domain, order, ownerSigner);

    const error = await swap.check([
      swapId,
      nonce,
      user,
      sellAmount,
      buyAmount,
      referrer,
      signature.v,
      signature.r,
      signature.s,
    ]);

    assert.bnEqual(error[0], BigNumber.from(1));
  });
});

  describe("#averagePriceForOffer", () => {
    const minPrice = parseUnits("3", 6);
    const minBidSize = parseUnits("0.01", 8);
    const totalSize = parseUnits("1", 8);
    let swapId: number;

    time.revertToSnapshotAfterEach(async function () {
      swapId = (await swap.offersCounter()).add(1);

      await swap
        .connect(keeperSigner)
        .createOffer(wethAddress, usdcAddress, minPrice, minBidSize, totalSize);
    });

    it("reverts when offering does not exist", async function () {
      await expect(swap.averagePriceForOffer(2)).to.be.revertedWith(
        "Offer does not exist"
      );
    });

    it("returns the correct average after full settlement", async function () {
      const nonce = 1;

      const sellAmount = totalSize.mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize;
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await swap.connect(keeperSigner).settleOffer(swapId, bids);

      const average = await swap.averagePriceForOffer(1);
      assert.bnEqual(average, sellAmount.mul(10 ** 8).div(buyAmount));
    });

    it("returns the correct average after partial settlement", async function () {
      const nonce = 1;

      const sellAmount = totalSize.div(2).mul(minPrice).div(parseUnits("1", 8));
      const buyAmount = totalSize.div(2);
      const referrer = constants.AddressZero;

      const order = {
        swapId,
        nonce,
        signerWallet: user,
        sellAmount,
        buyAmount,
        referrer,
      };

      const signature = await getSignature(domain, order, userSigner);

      const bids = [
        [
          swapId,
          nonce,
          user,
          sellAmount,
          buyAmount,
          referrer,
          signature.v,
          signature.r,
          signature.s,
        ],
      ];

      await swap.connect(keeperSigner).settleOffer(swapId, bids);

      const average = await swap.averagePriceForOffer(1);
      assert.bnEqual(average, sellAmount.mul(10 ** 8).div(buyAmount));
    });
  });
});
