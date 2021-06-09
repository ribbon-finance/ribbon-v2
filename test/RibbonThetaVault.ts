import { ethers } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, constants, Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import moment from "moment-timezone";
import * as time from "./helpers/time";
import {
  CHAINLINK_WBTC_PRICER,
  CHAINLINK_WETH_PRICER,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  USDC_OWNER_ADDRESS,
  WBTC_ADDRESS,
  WBTC_OWNER_ADDRESS,
  WETH_ADDRESS,
  GNOSIS_EASY_AUCTION,
} from "./helpers/constants";
import {
  deployProxy,
  // setupOracle,
  // setOpynOracleExpiryPrice,
  whitelistProduct,
  mintToken,
  bidForOToken,
} from "./helpers/utils";
// import { wmul } from "./helpers/math";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { assert } from "./helpers/assertions";

const { provider, getContractAt } = ethers;
const { parseEther } = ethers.utils;

moment.tz.setDefault("UTC");

const OPTION_DELAY = 60 * 60; // 1 hour
const gasPrice = parseUnits("1", "gwei");

describe("RibbonThetaVault", () => {
  behavesLikeRibbonOptionsVault({
    name: `Ribbon WBTC Theta Vault (Call)`,
    tokenName: "Ribbon BTC Theta Vault",
    tokenSymbol: "rWBTC-THETA",
    asset: WBTC_ADDRESS,
    assetContractName: "IWBTC",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: WBTC_ADDRESS,
    firstOptionStrike: 2400,
    secondOptionStrike: 2500,
    chainlinkPricer: CHAINLINK_WBTC_PRICER,
    tokenDecimals: 18,
    depositAmount: BigNumber.from("100000000"),
    premium: BigNumber.from("10000000"),
    premiumDiscount: BigNumber.from("997"),
    minimumSupply: BigNumber.from("10").pow("3").toString(),
    expectedMintAmount: BigNumber.from("90000000"),
    isPut: false,
    gasLimits: {
      depositWorstCase: 100000,
      depositBestCase: 90000,
    },
    mintConfig: {
      contractOwnerAddress: WBTC_OWNER_ADDRESS,
    },
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon ETH Theta Vault (Call)`,
    tokenName: "Ribbon ETH Theta Vault",
    tokenSymbol: "rETH-THETA",
    asset: WETH_ADDRESS,
    assetContractName: "IWETH",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: WETH_ADDRESS,
    firstOptionStrike: 63000,
    secondOptionStrike: 64000,
    chainlinkPricer: CHAINLINK_WETH_PRICER,
    depositAmount: parseEther("1"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("90000000"),
    premium: parseEther("0.1"),
    premiumDiscount: BigNumber.from("997"),
    tokenDecimals: 8,
    isPut: false,
    gasLimits: {
      depositWorstCase: 100000,
      depositBestCase: 90000,
    },
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon WBTC Theta Vault (Put)`,
    tokenName: "Ribbon BTC Theta Vault Put",
    tokenSymbol: "rWBTC-THETA-P",
    asset: WBTC_ADDRESS,
    assetContractName: "IERC20",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: USDC_ADDRESS,
    firstOptionStrike: 2400,
    secondOptionStrike: 2500,
    chainlinkPricer: CHAINLINK_WBTC_PRICER,
    tokenDecimals: 18,
    depositAmount: BigNumber.from("100000000"),
    premium: BigNumber.from("10000000"),
    premiumDiscount: BigNumber.from("997"),
    minimumSupply: BigNumber.from("10").pow("3").toString(),
    expectedMintAmount: BigNumber.from("3750000"),
    isPut: true,
    gasLimits: {
      depositWorstCase: 110000,
      depositBestCase: 95000,
    },
    mintConfig: {
      contractOwnerAddress: USDC_OWNER_ADDRESS,
    },
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon ETH Theta Vault (Put) `,
    tokenName: "Ribbon ETH Theta Vault Put",
    tokenSymbol: "rETH-THETA-P",
    asset: WETH_ADDRESS,
    assetContractName: "IERC20",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: USDC_ADDRESS,
    firstOptionStrike: 63000,
    secondOptionStrike: 64000,
    chainlinkPricer: CHAINLINK_WETH_PRICER,
    depositAmount: BigNumber.from("100000000000"),
    premium: BigNumber.from("10000000000"),
    premiumDiscount: BigNumber.from("997"),
    minimumSupply: BigNumber.from("10").pow("3").toString(),
    expectedMintAmount: BigNumber.from("142857142"),
    tokenDecimals: 8,
    isPut: true,
    gasLimits: {
      depositWorstCase: 110000,
      depositBestCase: 95000,
    },
    mintConfig: {
      contractOwnerAddress: USDC_OWNER_ADDRESS,
    },
  });
});

type Option = {
  address: string;
  strikePrice: BigNumber;
  expiry: number;
};

/**
 *
 * @param {Object} params - Parameter of option vault
 * @param {string} params.name - Name of test
 * @param {string} params.tokenName - Name of Option Vault
 * @param {string} params.tokenSymbol - Symbol of Option Vault
 * @param {number} params.tokenDecimals - Decimals of the vault shares
 * @param {string} params.asset - Address of assets
 * @param {string} params.assetContractName - Name of collateral asset contract
 * @param {string} params.strikeAsset - Address of strike assets
 * @param {string} params.collateralAsset - Address of asset used for collateral
 * @param {number} params.firstOptionStrike - Strike price of first option
 * @param {number} params.secondOptionStrike - Strike price of second option
 * @param {string} params.chainlinkPricer - Address of chainlink pricer
 * @param {Object=} params.mintConfig - Optional: For minting asset, if asset can be minted
 * @param {string} params.mintConfig.contractOwnerAddress - Impersonate address of mintable asset contract owner
 * @param {BigNumber} params.depositAmount - Deposit amount
 * @param {string} params.minimumSupply - Minimum supply to maintain for share and asset balance
 * @param {BigNumber} params.expectedMintAmount - Expected oToken amount to be minted with our deposit
 * @param {BigNumber} params.premium - Premium paid for options
 * @param {BigNumber} params.premiumDiscount - Premium discount of the sold options to incentivize arbitraguers (thousandths place: 000 - 999)
 * @param {boolean} params.isPut - Boolean flag for if the vault sells call or put options
 */
function behavesLikeRibbonOptionsVault(params: {
  name: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  asset: string;
  assetContractName: string;
  strikeAsset: string;
  collateralAsset: string;
  firstOptionStrike: number;
  secondOptionStrike: number;
  chainlinkPricer: string;
  depositAmount: BigNumber;
  minimumSupply: string;
  expectedMintAmount: BigNumber;
  premium: BigNumber;
  premiumDiscount: BigNumber;
  isPut: boolean;
  gasLimits: {
    depositWorstCase: number;
    depositBestCase: number;
  };
  mintConfig?: {
    contractOwnerAddress: string;
  };
}) {
  // Addresses
  let owner: string, user: string, manager: string, feeRecipient: string;

  // Signers
  let adminSigner: SignerWithAddress,
    userSigner: SignerWithAddress,
    ownerSigner: SignerWithAddress,
    managerSigner: SignerWithAddress,
    feeRecipientSigner: SignerWithAddress,
    counterpartySigner: SignerWithAddress;

  // Parameters
  let tokenName = params.tokenName;
  let tokenSymbol = params.tokenSymbol;
  let tokenDecimals = params.tokenDecimals;
  let minimumSupply = params.minimumSupply;
  let asset = params.asset;
  let collateralAsset = params.collateralAsset;
  let depositAmount = params.depositAmount;
  let premium = params.premium;
  let premiumDiscount = params.premiumDiscount;
  // let expectedMintAmount = params.expectedMintAmount;
  let isPut = params.isPut;

  // Contracts
  let strikeSelection: Contract;
  let optionsPremiumPricer: Contract;
  let gnosisAuction: Contract;
  let gammaProtocolLib: Contract;
  let vault: Contract;
  let oTokenFactory: Contract;
  let defaultOtoken: Contract;
  let assetContract: Contract;

  // Variables
  let defaultOtokenAddress: string;

  describe(`${params.name}`, () => {
    let initSnapshotId: string;
    let firstOption: Option;
    // let secondOption: Option;

    // const rollToNextOption = async () => {
    //   await strikeSelection.setStrikePrice(
    //     parseUnits(params.firstOptionStrike.toString(), 8)
    //   );

    //   await optionsPremiumPricer.setPremium(params.premium.toString());

    //   await vault.connect(managerSigner).commitAndClose();
    //   await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //   await vault.connect(managerSigner).rollToNextOption();
    // };

    before(async function () {
      initSnapshotId = await time.takeSnapshot();

      [
        adminSigner,
        ownerSigner,
        userSigner,
        managerSigner,
        feeRecipientSigner,
        counterpartySigner,
      ] = await ethers.getSigners();
      owner = ownerSigner.address;
      user = userSigner.address;
      manager = managerSigner.address;
      feeRecipient = feeRecipientSigner.address;

      const MockStrikeSelection = await ethers.getContractFactory(
        "MockStrikeSelection"
      );
      strikeSelection = await MockStrikeSelection.deploy();

      const MockOptionsPremiumPricer = await ethers.getContractFactory(
        "MockOptionsPremiumPricer"
      );
      optionsPremiumPricer = await MockOptionsPremiumPricer.deploy();

      const GammaProtocol = await ethers.getContractFactory("GammaProtocol");
      gammaProtocolLib = await GammaProtocol.deploy();

      gnosisAuction = await getContractAt(
        "IGnosisAuction",
        GNOSIS_EASY_AUCTION
      );

      const initializeTypes = [
        "address",
        "address",
        "uint256",
        "Tuple",
        "uint256",
        "address",
        "bool",
        "uint256",
        "address",
        "address",
      ];
      const initializeArgs = [
        owner,
        feeRecipient,
        parseEther("500"),
        [tokenName, tokenSymbol, tokenDecimals],
        minimumSupply,
        asset,
        isPut,
        premiumDiscount,
        strikeSelection.address,
        optionsPremiumPricer.address,
      ];

      const deployArgs = [
        WETH_ADDRESS,
        USDC_ADDRESS,
        OTOKEN_FACTORY,
        GAMMA_CONTROLLER,
        MARGIN_POOL,
        GNOSIS_EASY_AUCTION,
      ];

      vault = (
        await deployProxy(
          "RibbonThetaVault",
          adminSigner,
          initializeTypes,
          initializeArgs,
          deployArgs,
          {
            libraries: {
              GammaProtocol: gammaProtocolLib.address,
            },
          }
        )
      ).connect(userSigner);

      await vault.connect(ownerSigner).setManager(manager);

      oTokenFactory = await getContractAt("IOtokenFactory", OTOKEN_FACTORY);

      await whitelistProduct(
        params.asset,
        params.strikeAsset,
        params.collateralAsset,
        params.isPut
      );

      const latestTimestamp = (await provider.getBlock("latest")).timestamp;

      // Create first option
      const firstOptionExpiry = moment(latestTimestamp * 1000)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hours(8)
        .minutes(0)
        .seconds(0)
        .unix();

      const firstOptionAddress = await oTokenFactory.getTargetOtokenAddress(
        params.asset,
        params.strikeAsset,
        params.collateralAsset,
        parseUnits(params.firstOptionStrike.toString(), 8),
        firstOptionExpiry,
        params.isPut
      );

      firstOption = {
        address: firstOptionAddress,
        strikePrice: parseUnits(params.firstOptionStrike.toString(), 8),
        expiry: firstOptionExpiry,
      };

      // Create second option
      // const secondOptionExpiry = moment(latestTimestamp * 1000)
      //   .startOf("isoWeek")
      //   .add(2, "week")
      //   .day("friday")
      //   .hours(8)
      //   .minutes(0)
      //   .seconds(0)
      //   .unix();

      // const secondOptionAddress = await oTokenFactory.getTargetOtokenAddress(
      //   params.asset,
      //   params.strikeAsset,
      //   params.collateralAsset,
      //   parseUnits(params.secondOptionStrike.toString(), 8),
      //   secondOptionExpiry,
      //   params.isPut
      // );

      // secondOption = {
      //   address: secondOptionAddress,
      //   strikePrice: parseUnits(params.secondOptionStrike.toString(), 8),
      //   expiry: secondOptionExpiry,
      // };

      await strikeSelection.setStrikePrice(
        parseUnits(params.firstOptionStrike.toString(), 8)
      );

      await optionsPremiumPricer.setPremium(params.premium.toString());

      defaultOtokenAddress = firstOption.address;
      defaultOtoken = await getContractAt("IERC20", defaultOtokenAddress);
      assetContract = await getContractAt(
        params.assetContractName,
        collateralAsset
      );

      // If mintable token, then mine the token
      if (params.mintConfig) {
        const addressToDeposit = [userSigner, managerSigner, adminSigner];

        for (let i = 0; i < addressToDeposit.length; i++) {
          await mintToken(
            assetContract,
            params.mintConfig.contractOwnerAddress,
            addressToDeposit[i].address,
            vault.address,
            params.collateralAsset == USDC_ADDRESS
              ? BigNumber.from("10000000000000")
              : parseEther("200")
          );
        }
      }
    });

    after(async () => {
      await time.revertToSnapShot(initSnapshotId);
    });

    describe("constructor", () => {
      time.revertToSnapshotAfterEach();
    });

    describe("#initialize", () => {
      let testVault: Contract;

      time.revertToSnapshotAfterEach(async function () {
        const RibbonThetaVault = await ethers.getContractFactory(
          "RibbonThetaVault",
          {
            libraries: {
              GammaProtocol: gammaProtocolLib.address,
            },
          }
        );
        testVault = await RibbonThetaVault.deploy(
          WETH_ADDRESS,
          USDC_ADDRESS,
          OTOKEN_FACTORY,
          GAMMA_CONTROLLER,
          MARGIN_POOL,
          GNOSIS_EASY_AUCTION
        );
      });

      it("initializes with correct values", async function () {
        assert.equal((await vault.cap()).toString(), parseEther("500"));
        assert.equal(await vault.owner(), owner);
        assert.equal(await vault.feeRecipient(), feeRecipient);
        assert.equal(await vault.asset(), collateralAsset);
        assert.equal(await vault.WETH(), WETH_ADDRESS);
        assert.equal(await vault.USDC(), USDC_ADDRESS);
        assert.equal(await vault.minimumSupply(), params.minimumSupply);
        assert.equal(await vault.isPut(), params.isPut);
        assert.equal(
          (await vault.premiumDiscount()).toString(),
          params.premiumDiscount.toString()
        );
        assert.equal(
          await vault.optionsPremiumPricer(),
          optionsPremiumPricer.address
        );
        assert.equal(await vault.strikeSelection(), strikeSelection.address);
      });

      it("cannot be initialized twice", async function () {
        await expect(
          vault.initialize(
            owner,
            feeRecipient,
            parseEther("500"),
            [tokenName, tokenSymbol, tokenDecimals],
            minimumSupply,
            asset,
            isPut,
            premiumDiscount,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });

      it("reverts when initializing with 0 owner", async function () {
        await expect(
          testVault.initialize(
            constants.AddressZero,
            feeRecipient,
            parseEther("500"),
            [tokenName, tokenSymbol, tokenDecimals],
            minimumSupply,
            asset,
            isPut,
            premiumDiscount,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("!_owner");
      });

      it("reverts when initializing with 0 feeRecipient", async function () {
        await expect(
          testVault.initialize(
            owner,
            constants.AddressZero,
            parseEther("500"),
            [tokenName, tokenSymbol, tokenDecimals],
            minimumSupply,
            asset,
            isPut,
            premiumDiscount,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("!_feeRecipient");
      });

      it("reverts when initializing with 0 initCap", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            "0",
            [tokenName, tokenSymbol, tokenDecimals],
            minimumSupply,
            asset,
            isPut,
            premiumDiscount,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("!_initCap");
      });

      it("reverts when asset is 0x", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            parseEther("500"),
            [tokenName, tokenSymbol, tokenDecimals],
            minimumSupply,
            constants.AddressZero,
            isPut,
            premiumDiscount,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("!_asset");
      });

      it("reverts when decimals is 0", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            parseEther("500"),
            [tokenName, tokenSymbol, 0],
            minimumSupply,
            asset,
            isPut,
            premiumDiscount,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("!_tokenDecimals");
      });

      it("reverts when minimumSupply is 0", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            parseEther("500"),
            [tokenName, tokenSymbol, tokenDecimals],
            0,
            asset,
            isPut,
            premiumDiscount,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("!_minimumSupply");
      });

      it("reverts when premiumDiscount is 0", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            parseEther("500"),
            [tokenName, tokenSymbol, tokenDecimals],
            minimumSupply,
            asset,
            isPut,
            0,
            strikeSelection.address,
            optionsPremiumPricer.address
          )
        ).to.be.revertedWith("!_premiumDiscount");
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

    describe("#isPut", () => {
      it("returns the correct option type", async function () {
        assert.equal(await vault.isPut(), isPut);
      });
    });

    describe("#delay", () => {
      it("returns the delay", async function () {
        assert.equal((await vault.delay()).toNumber(), OPTION_DELAY);
      });
    });

    describe("#asset", () => {
      it("returns the asset", async function () {
        assert.equal(await vault.asset(), collateralAsset);
      });
    });

    describe("#owner", () => {
      it("returns the owner", async function () {
        assert.equal(await vault.owner(), owner);
      });
    });

    describe("#setManager", () => {
      time.revertToSnapshotAfterTest();

      it("reverts when setting 0x0 as manager", async function () {
        await expect(
          vault.connect(ownerSigner).setManager(constants.AddressZero)
        ).to.be.revertedWith("!newManager");
      });

      it("reverts when not owner call", async function () {
        await expect(vault.setManager(manager)).to.be.revertedWith(
          "caller is not the owner"
        );
      });

      it("sets the first manager", async function () {
        await vault.connect(ownerSigner).setManager(manager);
        assert.equal(await vault.manager(), manager);
      });

      it("changes the manager", async function () {
        await vault.connect(ownerSigner).setManager(owner);
        await vault.connect(ownerSigner).setManager(manager);
        assert.equal(await vault.manager(), manager);
      });
    });

    describe("#setFeeRecipient", () => {
      time.revertToSnapshotAfterTest();

      it("reverts when setting 0x0 as feeRecipient", async function () {
        await expect(
          vault.connect(ownerSigner).setManager(constants.AddressZero)
        ).to.be.revertedWith("!newManager");
      });

      it("reverts when not owner call", async function () {
        await expect(vault.setFeeRecipient(manager)).to.be.revertedWith(
          "caller is not the owner"
        );
      });

      it("changes the fee recipient", async function () {
        await vault.connect(ownerSigner).setFeeRecipient(manager);
        assert.equal(await vault.feeRecipient(), manager);
      });
    });

    // Only apply to when assets is WETH
    if (params.collateralAsset === WETH_ADDRESS) {
      describe("#depositETH", () => {
        time.revertToSnapshotAfterEach();

        it("creates pending deposit successfully", async function () {
          const startBalance = await provider.getBalance(user);

          const depositAmount = parseEther("1");
          const tx = await vault.depositETH({ value: depositAmount, gasPrice });
          const receipt = await tx.wait();
          const gasFee = receipt.gasUsed.mul(gasPrice);

          assert.bnEqual(
            await provider.getBalance(user),
            startBalance.sub(depositAmount).sub(gasFee)
          );

          // Unchanged for share balance and totalSupply
          assert.bnEqual(await vault.totalSupply(), BigNumber.from(0));
          assert.bnEqual(await vault.balanceOf(user), BigNumber.from(0));
          await expect(tx)
            .to.emit(vault, "Deposit")
            .withArgs(user, depositAmount, 0);

          assert.bnEqual(await vault.totalPending(), depositAmount);
          const { round, amount, processed } = await vault.depositReceipts(
            user
          );
          assert.equal(round, 0);
          assert.bnEqual(amount, depositAmount);
          assert.equal(processed, false);
        });

        it("fits gas budget [ @skip-on-coverage ]", async function () {
          const tx1 = await vault
            .connect(managerSigner)
            .depositETH({ value: parseEther("0.1") });
          const receipt1 = await tx1.wait();
          assert.isAtMost(receipt1.gasUsed.toNumber(), 130000);

          const tx2 = await vault.depositETH({ value: parseEther("0.1") });
          const receipt2 = await tx2.wait();
          assert.isAtMost(receipt2.gasUsed.toNumber(), 90000);

          // Uncomment to measure precise gas numbers
          // console.log(receipt1.gasUsed.toNumber());
          // console.log(receipt2.gasUsed.toNumber());
        });

        it("reverts when no value passed", async function () {
          await expect(
            vault.connect(userSigner).depositETH({ value: 0 })
          ).to.be.revertedWith("!value");
        });

        it("does not inflate the share tokens on initialization", async function () {
          await assetContract
            .connect(adminSigner)
            .deposit({ value: parseEther("10") });
          await assetContract
            .connect(adminSigner)
            .transfer(vault.address, parseEther("10"));

          await vault
            .connect(userSigner)
            .depositETH({ value: parseEther("1") });

          assert.isTrue((await vault.balanceOf(user)).isZero());
        });

        it("reverts when minimum shares are not minted", async function () {
          await expect(
            vault.connect(userSigner).depositETH({
              value: BigNumber.from("10").pow("10").sub(BigNumber.from("1")),
            })
          ).to.be.revertedWith("Insufficient balance");
        });
      });
    } else {
      describe("#depositETH", () => {
        it("reverts when asset is not WETH", async function () {
          const depositAmount = parseEther("1");
          await expect(
            vault.depositETH({ value: depositAmount })
          ).to.be.revertedWith("!WETH");
        });
      });
    }

    describe("#deposit", () => {
      time.revertToSnapshotAfterEach();

      beforeEach(async function () {
        // Deposit only if asset is WETH
        if (params.collateralAsset === WETH_ADDRESS) {
          const addressToDeposit = [userSigner, managerSigner, adminSigner];

          for (let i = 0; i < addressToDeposit.length; i++) {
            const weth = assetContract.connect(addressToDeposit[i]);
            await weth.deposit({ value: parseEther("10") });
            await weth.approve(vault.address, parseEther("10"));
          }
        }
      });

      it("creates a pending deposit", async function () {
        const startBalance = await assetContract.balanceOf(user);
        const depositAmount = BigNumber.from("100000000000");

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
          .withArgs(user, depositAmount, 0);

        assert.bnEqual(await vault.totalPending(), depositAmount);
        const { round, amount, processed } = await vault.depositReceipts(user);
        assert.equal(round, 0);
        assert.bnEqual(amount, depositAmount);
        assert.equal(processed, false);
      });

      it("tops up existing deposit", async function () {
        const startBalance = await assetContract.balanceOf(user);
        const depositAmount = BigNumber.from("100000000000");
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
          .withArgs(user, depositAmount, 0);

        assert.bnEqual(await vault.totalPending(), totalDepositAmount);
        const { round, amount, processed } = await vault.depositReceipts(user);
        assert.equal(round, 0);
        assert.bnEqual(amount, totalDepositAmount);
        assert.equal(processed, false);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        const depositAmount = BigNumber.from("100000000000");
        await vault.connect(managerSigner).deposit(depositAmount);

        const tx1 = await vault.deposit(depositAmount);
        const receipt1 = await tx1.wait();
        assert.isAtMost(
          receipt1.gasUsed.toNumber(),
          params.gasLimits.depositWorstCase
        );

        const tx2 = await vault.deposit(depositAmount);
        const receipt2 = await tx2.wait();
        assert.isAtMost(
          receipt2.gasUsed.toNumber(),
          params.gasLimits.depositBestCase
        );

        // Uncomment to log gas used
        // console.log(receipt1.gasUsed.toNumber());
        // console.log(receipt2.gasUsed.toNumber());
      });

      it("reverts when deposit amount exceeds uint128", async function () {
        const depositAmount = BigNumber.from(
          "340282366920938463463374607431768211455"
        );
        const totalDepositAmount = depositAmount.mul(BigNumber.from(2));

        await assetContract
          .connect(userSigner)
          .approve(vault.address, totalDepositAmount);

        await expect(vault.deposit(depositAmount)).to.be.revertedWith(
          "Overflow"
        );
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
    });

    describe("#commitAndClose", () => {
      time.revertToSnapshotAfterEach();

      it("reverts when not called with manager", async function () {
        await expect(
          vault.connect(userSigner).commitAndClose({ from: user })
        ).to.be.revertedWith("Only manager");
      });

      it("sets the next option and closes existing short", async function () {
        const res = await vault
          .connect(managerSigner)
          .commitAndClose({ from: manager });

        const receipt = await res.wait();
        const block = await provider.getBlock(receipt.blockNumber);

        assert.equal(await vault.nextOption(), defaultOtokenAddress);
        assert.equal(
          (await vault.nextOptionReadyAt()).toNumber(),
          block.timestamp + OPTION_DELAY
        );
        assert.isTrue((await vault.lockedAmount()).isZero());
        assert.equal(await vault.currentOption(), constants.AddressZero);
      });

      it("should set the next option twice", async function () {
        await vault.connect(managerSigner).commitAndClose();

        await vault.connect(managerSigner).commitAndClose();
      });
    });

    // describe("#closeShort", () => {
    //   let oracle: Contract;

    //   time.revertToSnapshotAfterEach(async function () {
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     oracle = await setupOracle(params.chainlinkPricer, ownerSigner);

    //     if (params.collateralAsset === WETH_ADDRESS) {
    //       const weth = assetContract.connect(counterpartySigner);
    //       await weth.deposit({ value: premium });
    //       await weth.approve(SWAP_CONTRACT, premium);
    //       return;
    //     }

    //     if (params.mintConfig) {
    //       await mintToken(
    //         assetContract,
    //         params.mintConfig.contractOwnerAddress,
    //         counterpartySigner.address,
    //         SWAP_CONTRACT,
    //         premium
    //       );
    //       return;
    //     }
    //   });

    //   it("doesnt do anything when no existing short", async function () {
    //     const tx = await vault.closeShort();
    //     await expect(tx).to.not.emit(vault, "CloseShort");
    //   });

    //   it("reverts when closing short before expiry", async function () {
    //     await vault.connect(managerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     await vault.connect(managerSigner).rollToNextOption();

    //     await expect(vault.closeShort()).to.be.revertedWith("Before expiry");
    //   });

    //   it("closes the short after expiry", async function () {
    //     await vault.connect(managerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     await vault.connect(managerSigner).rollToNextOption();

    describe.skip("#burnRemainingOTokens", () => {
      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(params.collateralAsset, vault, depositAmount);

        if (params.collateralAsset === WETH_ADDRESS) {
          const weth = assetContract.connect(counterpartySigner);
          await weth.deposit({ value: premium });
          return;
        }

        await vault.connect(managerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(managerSigner).rollToNextOption();
      });

      it("reverts when not called with manager", async function () {
        await expect(
          vault.connect(userSigner).burnRemainingOTokens()
        ).to.be.revertedWith("Only manager");
      });

      it("reverts when trying to burn 0 OTokens", async function () {
        const auctionDetails = await bidForOToken(
          gnosisAuction,
          optionsPremiumPricer,
          assetContract,
          userSigner.address,
          defaultOtokenAddress,
          params.premium,
          "1"
        );

        await gnosisAuction
          .connect(userSigner)
          .settleAuction(auctionDetails[0]);

        await expect(
          vault.connect(managerSigner).burnRemainingOTokens()
        ).to.be.revertedWith("No OTokens to burn!");
      });

      it("burns all remaining oTokens", async function () {
        const auctionDetails = await bidForOToken(
          gnosisAuction,
          optionsPremiumPricer,
          assetContract,
          userSigner.address,
          defaultOtokenAddress,
          params.premium,
          "2"
        );

        const vaultOTokenBalanceBefore = (
          await defaultOtoken.balanceOf(vault.address)
        ).toString();
        await gnosisAuction
          .connect(userSigner)
          .settleAuction(auctionDetails[0]);
        const vaultOTokenBalanceAfter = (
          await defaultOtoken.balanceOf(vault.address)
        ).toString();

        assert.isAbove(
          parseInt(vaultOTokenBalanceAfter),
          parseInt(vaultOTokenBalanceBefore)
        );

        const collateralBalanceBefore = (
          await assetContract.balanceOf(vault.address)
        ).toString();
        vault.connect(managerSigner).burnRemainingOTokens();
        const collateralBalanceAfter = (
          await assetContract.balanceOf(vault.address)
        ).toString();

        assert.isAbove(
          parseInt(collateralBalanceAfter),
          parseInt(collateralBalanceBefore)
        );
      });
    });

    // describe.skip("#rollToNextOption", () => {
    //   let oracle: Contract;

    //   time.revertToSnapshotAfterEach(async function () {
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     oracle = await setupOracle(params.chainlinkPricer, ownerSigner);

    //     if (params.collateralAsset === WETH_ADDRESS) {
    //       const weth = assetContract.connect(counterpartySigner);
    //       await weth.deposit({ value: premium });
    //       return;
    //     }
    //   });

    //   it("reverts when delay not passed", async function () {
    //     await vault.connect(managerSigner).commitAndClose();

    //     // will revert when trying to roll immediately
    //     await expect(
    //       vault.connect(managerSigner).rollToNextOption()
    //     ).to.be.revertedWith("Not ready");

    //     time.increaseTo(
    //       (await vault.nextOptionReadyAt()).sub(BigNumber.from("1"))
    //     );

    //     await expect(
    //       vault.connect(managerSigner).rollToNextOption()
    //     ).to.be.revertedWith("Not ready");
    //   });

    //   it("mints oTokens and deposits collateral into vault", async function () {
    //     const lockedAmount = wmul(depositAmount, LOCKED_RATIO);
    //     const availableAmount = wmul(depositAmount, WITHDRAWAL_BUFFER);

    //     const startMarginBalance = await assetContract.balanceOf(MARGIN_POOL);

    //     await vault.connect(managerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const res = vault.connect(managerSigner).rollToNextOption();

    //     await expect(res).to.not.emit(vault, "CloseShort");

    //     await expect(res)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(defaultOtokenAddress, lockedAmount, manager);

    //     await expect(res)
    //       .to.emit(vault, "InitiateGnosisAuction")
    //       .withArgs(
    //         defaultOtokenAddress,
    //         params.collateralAsset,
    //         await gnosisAuction.auctionCounter(),
    //         manager
    //       );

    //     assert.equal((await vault.lockedAmount()).toString(), lockedAmount);

    //     assert.equal((await vault.assetBalance()).toString(), availableAmount);

    //     assert.equal(
    //       (await assetContract.balanceOf(MARGIN_POOL))
    //         .sub(startMarginBalance)
    //         .toString(),
    //       lockedAmount.toString()
    //     );

    //     assert.equal(
    //       (await defaultOtoken.balanceOf(GNOSIS_EASY_AUCTION)).toString(),
    //       expectedMintAmount.toString()
    //     );

    //     assert.equal(await vault.currentOption(), defaultOtokenAddress);
    //   });

    //   it("reverts when calling before expiry", async function () {
    //     const firstOptionAddress = firstOption.address;

    //     await vault.connect(managerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(managerSigner).rollToNextOption();

    //     // will revert when trying to roll immediately
    //     await expect(
    //       vault.connect(managerSigner).rollToNextOption()
    //     ).to.be.revertedWith("Not ready");

    //     time.increaseTo(
    //       (await vault.nextOptionReadyAt()).sub(BigNumber.from("1"))
    //     );

    //     await expect(
    //       vault.connect(managerSigner).rollToNextOption()
    //     ).to.be.revertedWith("Not ready");
    //   });

    //   it("mints oTokens and deposits collateral into vault", async function () {
    //     const lockedAmount = wmul(depositAmount, LOCKED_RATIO);
    //     const availableAmount = wmul(depositAmount, WITHDRAWAL_BUFFER);

    //     const startMarginBalance = await assetContract.balanceOf(MARGIN_POOL);

    //     await vault.connect(managerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const res = vault.connect(managerSigner).rollToNextOption();

    //     await expect(res).to.not.emit(vault, "CloseShort");

    //     await expect(res)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(defaultOtokenAddress, lockedAmount, manager);

    //     assert.equal((await vault.lockedAmount()).toString(), lockedAmount);

    //     assert.equal((await vault.assetBalance()).toString(), availableAmount);

    //     assert.equal(
    //       (await assetContract.balanceOf(MARGIN_POOL))
    //         .sub(startMarginBalance)
    //         .toString(),
    //       lockedAmount.toString()
    //     );

    //     assert.equal(
    //       (await defaultOtoken.balanceOf(vault.address)).toString(),
    //       expectedMintAmount.toString()
    //     );

    //     assert.equal(await vault.currentOption(), defaultOtokenAddress);
    //   });

    //   it("reverts when calling before expiry", async function () {
    //     const firstOptionAddress = firstOption.address;

    //     await vault.connect(managerSigner).commitAndClose();

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(managerSigner).rollToNextOption();

    //     const lockedAmount = wmul(depositAmount, LOCKED_RATIO);
    //     const withdrawBuffer = wmul(depositAmount, parseEther("0.1"));

    //     await expect(firstTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(firstOptionAddress, lockedAmount, manager);

    //     // 90% of the vault's balance is allocated to short
    //     assert.equal(
    //       (await assetContract.balanceOf(vault.address)).toString(),
    //       withdrawBuffer.toString()
    //     );

    //     await expect(
    //       vault.connect(managerSigner).commitAndClose()
    //     ).to.be.revertedWith("Before expiry");
    //   });

    //   it("withdraws and roll funds into next option, after expiry ITM", async function () {
    //     const firstOptionAddress = firstOption.address;
    //     const secondOptionAddress = secondOption.address;

    //     await vault.connect(managerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(managerSigner).rollToNextOption();

    //     assert.equal(await vault.currentOption(), firstOptionAddress);
    //     assert.equal(await vault.currentOptionExpiry(), firstOption.expiry);

    //     await expect(firstTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(
    //         firstOptionAddress,
    //         wmul(depositAmount, LOCKED_RATIO),
    //         manager
    //       );

    //     await depositIntoVault(params.collateralAsset, vault, premium);

    //     // only the premium should be left over because the funds are locked into Opyn
    //     assert.equal(
    //       (await assetContract.balanceOf(vault.address)).toString(),
    //       wmul(depositAmount, WITHDRAWAL_BUFFER).add(premium)
    //     );

    //     const settlementPriceITM = isPut
    //       ? parseEther(params.firstOptionStrike.toString())
    //           .div(BigNumber.from("10").pow(BigNumber.from("10")))
    //           .sub(1)
    //       : parseEther(params.firstOptionStrike.toString())
    //           .div(BigNumber.from("10").pow(BigNumber.from("10")))
    //           .add(1);

    //     // withdraw 100% because it's OTM
    //     await setOpynOracleExpiryPrice(
    //       params.asset,
    //       oracle,
    //       await vault.currentOptionExpiry(),
    //       settlementPriceITM
    //     );

    //     const beforeBalance = await assetContract.balanceOf(vault.address);

    //     await strikeSelection.setStrikePrice(
    //       parseUnits(params.secondOptionStrike.toString(), 8)
    //     );

    //     const firstCloseTx = await vault
    //       .connect(managerSigner)
    //       .commitAndClose();

    //     const afterBalance = await assetContract.balanceOf(vault.address);

    //     // test that the vault's balance decreased after closing short when ITM
    //     assert.isAbove(
    //       parseInt(wmul(depositAmount, LOCKED_RATIO).toString()),
    //       parseInt(BigNumber.from(afterBalance).sub(beforeBalance).toString())
    //     );

    //     await expect(firstCloseTx)
    //       .to.emit(vault, "CloseShort")
    //       .withArgs(
    //         firstOptionAddress,
    //         BigNumber.from(afterBalance).sub(beforeBalance),
    //         manager
    //       );

    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const currBalance = await assetContract.balanceOf(vault.address);
    //     const mintAmount = wmul(currBalance, LOCKED_RATIO).toString();

    //     const secondTx = await vault.connect(managerSigner).rollToNextOption();

    //     assert.equal(await vault.currentOption(), secondOptionAddress);
    //     assert.equal(await vault.currentOptionExpiry(), secondOption.expiry);

    //     await expect(secondTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(secondOptionAddress, mintAmount, manager);

    //     assert.equal(
    //       (await assetContract.balanceOf(vault.address)).toString(),
    //       wmul(currBalance, WITHDRAWAL_BUFFER).toString()
    //     );
    //   });

    //   it("withdraws and roll funds into next option, after expiry OTM", async function () {
    //     const firstOptionAddress = firstOption.address;
    //     const secondOptionAddress = secondOption.address;

    //     await vault.connect(managerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const firstTx = await vault.connect(managerSigner).rollToNextOption();

    //     await expect(firstTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(
    //         firstOptionAddress,
    //         wmul(depositAmount, LOCKED_RATIO),
    //         manager
    //       );

    //     await depositIntoVault(params.collateralAsset, vault, premium);

    //     // only the premium should be left over because the funds are locked into Opyn
    //     assert.equal(
    //       (await assetContract.balanceOf(vault.address)).toString(),
    //       wmul(depositAmount, WITHDRAWAL_BUFFER).add(premium)
    //     );

    //     const settlementPriceOTM = isPut
    //       ? parseEther(params.firstOptionStrike.toString())
    //           .div(BigNumber.from("10").pow(BigNumber.from("10")))
    //           .add(1)
    //       : parseEther(params.firstOptionStrike.toString())
    //           .div(BigNumber.from("10").pow(BigNumber.from("10")))
    //           .sub(1);

    //     // withdraw 100% because it's OTM
    //     await setOpynOracleExpiryPrice(
    //       params.asset,
    //       oracle,
    //       await vault.currentOptionExpiry(),
    //       settlementPriceOTM
    //     );

    //     const beforeBalance = await assetContract.balanceOf(vault.address);

    //     await strikeSelection.setStrikePrice(
    //       parseUnits(params.secondOptionStrike.toString(), 8)
    //     );

    //     const firstCloseTx = await vault
    //       .connect(managerSigner)
    //       .commitAndClose();

    //     const afterBalance = await assetContract.balanceOf(vault.address);
    //     // test that the vault's balance decreased after closing short when ITM
    //     assert.equal(
    //       parseInt(wmul(depositAmount, LOCKED_RATIO).toString()),
    //       parseInt(BigNumber.from(afterBalance).sub(beforeBalance).toString())
    //     );

    //     await expect(firstCloseTx)
    //       .to.emit(vault, "CloseShort")
    //       .withArgs(
    //         firstOptionAddress,
    //         BigNumber.from(afterBalance).sub(beforeBalance),
    //         manager
    //       );

    //     // Time increase to after next option available
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     const secondTx = await vault.connect(managerSigner).rollToNextOption();

    //     assert.equal(await vault.currentOption(), secondOptionAddress);
    //     assert.equal(await vault.currentOptionExpiry(), secondOption.expiry);

    //     await expect(secondTx)
    //       .to.emit(vault, "OpenShort")
    //       .withArgs(
    //         secondOptionAddress,
    //         wmul(depositAmount.add(premium), LOCKED_RATIO),
    //         manager
    //       );

    //     assert.equal(
    //       (await assetContract.balanceOf(vault.address)).toString(),
    //       wmul(depositAmount.add(premium), WITHDRAWAL_BUFFER)
    //     );
    //   });

    //   it("is not able to roll to new option consecutively without setNextOption", async function () {
    //     await vault.connect(managerSigner).commitAndClose();
    //     await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

    //     await vault.connect(managerSigner).rollToNextOption();

    //     await expect(
    //       vault.connect(managerSigner).rollToNextOption()
    //     ).to.be.revertedWith("!nextOption");
    //   });
    // });

    // describe("#assetBalance", () => {
    //   time.revertToSnapshotAfterEach(async function () {
    //     depositAmount = BigNumber.from("100000000000");

    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     assert.equal((await vault.totalSupply()).toString(), depositAmount);

    //     await rollToNextOption();
    //   });

    //   it("returns the free balance, after locking", async function () {
    //     assert.equal(
    //       (await vault.assetBalance()).toString(),
    //       wmul(depositAmount, parseEther("0.1")).toString()
    //     );
    //   });

    //   it("returns the free balance - locked, if free > locked", async function () {
    //     const newDepositAmount = BigNumber.from("1000000000000");
    //     await depositIntoVault(params.collateralAsset, vault, newDepositAmount);

    //     const freeAmount = newDepositAmount.add(
    //       wmul(depositAmount, parseEther("0.1"))
    //     );

    //     assert.equal((await vault.assetBalance()).toString(), freeAmount);
    //   });
    // });

    // describe("#withdrawAmountWithShares", () => {
    //   time.revertToSnapshotAfterEach();

    //   it("returns the correct withdrawal amount", async function () {
    //     await depositIntoVault(
    //       params.collateralAsset,
    //       vault,
    //       BigNumber.from("100000000000")
    //     );

    //     const balanceBeforeWithdraw = await assetContract.balanceOf(user);

    //     const [withdrawAmount, feeAmount] =
    //       await vault.withdrawAmountWithShares(BigNumber.from("10000000000"));

    //     assert.equal(withdrawAmount.toString(), BigNumber.from("9950000000"));
    //     assert.equal(feeAmount.toString(), BigNumber.from("50000000"));

    //     await vault.withdraw(BigNumber.from("10000000000"));

    //     // End balance should be start balance + withdraw amount
    //     assert.equal(
    //       parseInt(await assetContract.balanceOf(user)).toString(),
    //       parseInt(balanceBeforeWithdraw.add(withdrawAmount)).toString()
    //     );
    //   });
    // });

    // describe("#maxWithdrawAmount", () => {
    //   time.revertToSnapshotAfterEach();

    //   it("returns the max withdrawable amount accounting for the MINIMUM_SUPPLY", async function () {
    //     const depositAmount = BigNumber.from("100000000000");

    //     const minWithdrawAmount = depositAmount.sub(
    //       await vault.minimumSupply()
    //     );

    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     assert.equal(
    //       (await vault.maxWithdrawAmount(user)).toString(),
    //       minWithdrawAmount
    //     );
    //   });

    //   it("returns the max withdrawable amount", async function () {
    //     const depositAmount = BigNumber.from("900000000000");
    //     await depositIntoVault(
    //       params.collateralAsset,
    //       vault.connect(managerSigner),
    //       depositAmount
    //     );
    //     await depositIntoVault(
    //       params.collateralAsset,
    //       vault,
    //       BigNumber.from("100000000000")
    //     );

    //     assert.equal(
    //       (await vault.maxWithdrawAmount(user)).toString(),
    //       BigNumber.from("100000000000").toString()
    //     );
    //   });
    // });

    // describe("#maxWithdrawableShares", () => {
    //   time.revertToSnapshotAfterEach();

    //   it("returns the max shares withdrawable of the system", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     assert.equal(
    //       (await vault.maxWithdrawableShares()).toString(),
    //       depositAmount.sub(await vault.minimumSupply()).toString()
    //     );
    //   });
    // });

    // describe("#accountVaultBalance", () => {
    //   time.revertToSnapshotAfterEach();

    //   it("returns the ETH balance of the account in the vault", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     // Will be exactly the same number of Ether deposited initiall
    //     assert.equal(
    //       (await vault.accountVaultBalance(user)).toString(),
    //       depositAmount
    //     );

    //     // simulate the vault accumulating more WETH
    //     if (params.collateralAsset === WETH_ADDRESS) {
    //       await assetContract
    //         .connect(userSigner)
    //         .deposit({ value: parseEther("1") });
    //     }
    //     await assetContract
    //       .connect(userSigner)
    //       .transfer(vault.address, depositAmount);

    //     // User should be entitled to withdraw 2 ETH because the vault's balance expanded by 1 ETH
    //     assert.equal(
    //       (await vault.accountVaultBalance(user)).toString(),
    //       depositAmount.add(depositAmount)
    //     );
    //   });
    // });

    // describe("#assetAmountToShares", () => {
    //   time.revertToSnapshotAfterEach();

    //   it("should return the correct number of shares", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     // Will be exactly the same number of Ether deposited initially
    //     assert.equal(
    //       (await vault.assetAmountToShares(depositAmount)).toString(),
    //       depositAmount
    //     );

    //     // simulate the vault accumulating more WETH
    //     if (params.collateralAsset === WETH_ADDRESS) {
    //       await assetContract
    //         .connect(userSigner)
    //         .deposit({ value: parseEther("1") });
    //     }
    //     await assetContract
    //       .connect(userSigner)
    //       .transfer(vault.address, depositAmount);

    //     // User should be able to withdraw 2 ETH with 1 share
    //     assert.equal(
    //       (
    //         await vault.assetAmountToShares(depositAmount.add(depositAmount))
    //       ).toString(),
    //       depositAmount
    //     );
    //   });
    // });

    // describe("#withdrawLater", () => {
    //   time.revertToSnapshotAfterEach();

    //   it("is within the gas budget [ @skip-on-coverage ]", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     const res = await vault.withdrawLater(BigNumber.from("100000000000"));
    //     const receipt = await res.wait();
    //     assert.isAtMost(receipt.gasUsed.toNumber(), 100000);
    //   });

    //   it("rejects a withdrawLater of 0 shares", async function () {
    //     await expect(
    //       vault.withdrawLater(BigNumber.from("0"))
    //     ).to.be.revertedWith("!shares");
    //   });

    //   it("rejects a scheduled withdrawal when greater than balance", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     await expect(
    //       vault.withdrawLater(BigNumber.from("100000000001"))
    //     ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
    //   });

    //   it("accepts a withdrawLater if less than or equal to balance", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     const res = await vault.withdrawLater(BigNumber.from("100000000000"));

    //     await expect(res)
    //       .to.emit(vault, "ScheduleWithdraw")
    //       .withArgs(user, BigNumber.from("100000000000"));

    //     assert.equal(
    //       (await vault.queuedWithdrawShares()).toString(),
    //       BigNumber.from("100000000000").toString()
    //     );

    //     assert.equal(
    //       (await vault.scheduledWithdrawals(user)).toString(),
    //       BigNumber.from("100000000000").toString()
    //     );

    //     // Verify that vault shares were transfer to vault for duration of scheduledWithdraw
    //     assert.equal(
    //       (await vault.balanceOf(vault.address)).toString(),
    //       BigNumber.from("100000000000").toString()
    //     );

    //     assert.equal(
    //       (await vault.balanceOf(user)).toString(),
    //       BigNumber.from("0").toString()
    //     );
    //   });

    //   it("rejects a withdrawLater if a withdrawal is already scheduled", async function () {
    //     const depositAmount = BigNumber.from("200000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     await vault.withdrawLater(BigNumber.from("100000000000"));

    //     await expect(
    //       vault.withdrawLater(BigNumber.from("100000000000"))
    //     ).to.be.revertedWith("Existing withdrawal");
    //   });

    //   it("assets reserved by withdrawLater are not used to short", async function () {
    //     const depositAmount = BigNumber.from("200000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     const res = await vault.withdrawLater(BigNumber.from("100000000000"));

    //     await expect(res)
    //       .to.emit(vault, "ScheduleWithdraw")
    //       .withArgs(user, BigNumber.from("100000000000"));

    //     await rollToNextOption();

    //     const vaultBalanceBeforeWithdraw = await assetContract.balanceOf(
    //       vault.address
    //     );

    //     // Queued withdrawals + 10% of available assets set aside
    //     assert.equal(
    //       vaultBalanceBeforeWithdraw.toString(),
    //       BigNumber.from("110000000000").toString()
    //     );
    //   });
    // });

    // describe("completeScheduledWithdrawal", () => {
    //   time.revertToSnapshotAfterEach();

    //   it("is within the gas budget [ @skip-on-coverage ]", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     await vault.withdrawLater(BigNumber.from("1000"));

    //     const res = await vault.completeScheduledWithdrawal();

    //     const receipt = await res.wait();
    //     assert.isAtMost(receipt.gasUsed.toNumber(), 90000);
    //   });

    //   it("rejects a completeScheduledWithdrawal if nothing scheduled", async function () {
    //     const depositAmount = BigNumber.from("100000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     await expect(vault.completeScheduledWithdrawal()).to.be.revertedWith(
    //       "No withdrawal"
    //     );
    //   });

    //   it("completeScheduledWithdraw behaves as expected for valid scheduled withdraw", async function () {
    //     let balanceBeforeWithdraw;
    //     const depositAmount = BigNumber.from("200000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     await vault.withdrawLater(BigNumber.from("100000000000"));

    //     await rollToNextOption();

    //     if (params.collateralAsset === WETH_ADDRESS) {
    //       balanceBeforeWithdraw = await provider.getBalance(user);
    //     } else {
    //       balanceBeforeWithdraw = await assetContract.balanceOf(user);
    //     }
    //     const vaultBalanceBeforeWithdraw = await assetContract.balanceOf(
    //       vault.address
    //     );

    //     // Queued withdrawals + 10% of available assets set aside
    //     assert.equal(
    //       vaultBalanceBeforeWithdraw.toString(),
    //       BigNumber.from("110000000000").toString()
    //     );

    //     const tx = await vault.completeScheduledWithdrawal({
    //       gasPrice,
    //     });
    //     const receipt = await tx.wait();
    //     const gasFee = gasPrice.mul(receipt.gasUsed);

    //     await expect(tx)
    //       .to.emit(vault, "Withdraw")
    //       .withArgs(
    //         user,
    //         BigNumber.from("99500000000"),
    //         BigNumber.from("100000000000"),
    //         BigNumber.from("500000000")
    //       );

    //     await expect(tx)
    //       .to.emit(vault, "ScheduledWithdrawCompleted")
    //       .withArgs(user, BigNumber.from("99500000000"));

    //     // Should set the scheduledWithdrawals entry back to 0
    //     assert.equal(
    //       (await vault.scheduledWithdrawals(user)).toString(),
    //       BigNumber.from("0").toString()
    //     );

    //     assert.equal(
    //       (await assetContract.balanceOf(vault.address)).toString(),
    //       vaultBalanceBeforeWithdraw
    //         .sub(BigNumber.from("100000000000"))
    //         .toString()
    //     );

    //     // Assert vault shares were burned
    //     assert.equal(
    //       (await vault.balanceOf(vault.address)).toString(),
    //       BigNumber.from("0").toString()
    //     );

    //     if (params.collateralAsset === WETH_ADDRESS) {
    //       assert.equal(
    //         (await provider.getBalance(user)).toString(),
    //         balanceBeforeWithdraw
    //           .sub(gasFee)
    //           .add(BigNumber.from("99500000000"))
    //           .toString()
    //       );
    //       assert.equal(
    //         (await assetContract.balanceOf(feeRecipient)).toString(),
    //         BigNumber.from("500000000").toString()
    //       );
    //     } else {
    //       assert.equal(
    //         (await assetContract.balanceOf(user)).toString(),
    //         balanceBeforeWithdraw.add(BigNumber.from("99500000000")).toString()
    //       );
    //       assert.equal(
    //         (await assetContract.balanceOf(feeRecipient)).toString(),
    //         BigNumber.from("500000000").toString()
    //       );
    //     }
    //   });

    //   it("rejects second attempted completeScheduledWithdraw", async function () {
    //     const depositAmount = BigNumber.from("200000000000");
    //     await depositIntoVault(params.collateralAsset, vault, depositAmount);

    //     await vault.withdrawLater(BigNumber.from("100000000000"));

    //     await rollToNextOption();

    //     await vault.completeScheduledWithdrawal();

    //     await expect(vault.completeScheduledWithdrawal()).to.be.revertedWith(
    //       "No withdrawal"
    //     );
    //   });
    // });

    describe("#setCap", () => {
      time.revertToSnapshotAfterEach();

      it("should revert if not manager", async function () {
        await expect(
          vault.connect(userSigner).setCap(parseEther("10"))
        ).to.be.revertedWith("Only manager");
      });

      it("should set the new cap", async function () {
        await vault.connect(managerSigner).setCap(parseEther("10"));
        assert.equal((await vault.cap()).toString(), parseEther("10"));
      });

      it("should revert when depositing over the cap", async function () {
        const capAmount = BigNumber.from("100000000");
        const depositAmount = BigNumber.from("10000000000");
        await vault.connect(managerSigner).setCap(capAmount);

        // Provide some WETH to the account
        if (params.collateralAsset === WETH_ADDRESS) {
          const weth = assetContract.connect(userSigner);
          await weth.deposit({ value: depositAmount });
          await weth.approve(vault.address, depositAmount);
        }

        await expect(vault.deposit(depositAmount)).to.be.revertedWith(
          "Exceed cap"
        );
      });
    });

    describe("#currentOptionExpiry", () => {
      it("should return 0 when currentOption not set", async function () {
        assert.equal((await vault.currentOptionExpiry()).toString(), "0");
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
}

async function depositIntoVault(
  asset: string,
  vault: Contract,
  amount: BigNumberish
) {
  if (asset === WETH_ADDRESS) {
    await vault.depositETH({ value: amount });
  } else {
    await vault.deposit(amount);
  }
}
