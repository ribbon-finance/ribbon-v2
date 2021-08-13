import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, constants, Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import OptionsPremiumPricer_ABI from "../constants/abis/OptionsPremiumPricer.json";
import TestVolOracle_ABI from "../constants/abis/TestVolOracle.json";
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
  OptionsPremiumPricer_BYTECODE,
  TestVolOracle_BYTECODE,
} from "../constants/constants";
import {
  deployProxy,
  setupOracle,
  setOpynOracleExpiryPrice,
  whitelistProduct,
  mintToken,
  closeAuctionAndClaim,
} from "./helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "./helpers/assertions";

const { provider, getContractAt, getContractFactory } = ethers;
const { parseEther } = ethers.utils;

moment.tz.setDefault("UTC");

const OPTION_DELAY = 60 * 60; // 1 hour
const gasPrice = parseUnits("1", "gwei");
const FEE_SCALING = BigNumber.from(10).pow(6);
const WEEKS_PER_YEAR = 52142857;

const PERIOD = 43200; // 12 hours

const ethusdcPool = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
const wbtcusdcPool = "0x99ac8ca7087fa4a2a1fb6357269965a2014abc35";

const wethPriceOracleAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const wbtcPriceOracleAddress = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const usdcPriceOracleAddress = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";

describe("RibbonDeltaVault", () => {
  behavesLikeRibbonOptionsVault({
    name: `Ribbon WBTC Delta Vault (Call)`,
    tokenName: "Ribbon BTC Delta Vault",
    tokenSymbol: "rWBTC-DELTA",
    asset: WBTC_ADDRESS,
    assetContractName: "IWBTC",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: WBTC_ADDRESS,
    chainlinkPricer: CHAINLINK_WBTC_PRICER,
    deltaFirstOption: BigNumber.from("1000"),
    deltaSecondOption: BigNumber.from("1000"),
    deltaStep: BigNumber.from("1000"),
    tokenDecimals: 8,
    depositAmount: BigNumber.from("100000000"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("2000000"),
    performanceFee: BigNumber.from("20000000"),
    optionAllocationPct: BigNumber.from("500"),
    optionPremium: BigNumber.from("1").mul(BigNumber.from("10").pow("8")),
    minimumSupply: BigNumber.from("10").pow("3").toString(),
    expectedMintAmount: BigNumber.from("100000000"),
    auctionDuration: 21600,
    isPut: false,
    gasLimits: {
      depositWorstCase: 101000,
      depositBestCase: 90000,
    },
    mintConfig: {
      contractOwnerAddress: WBTC_OWNER_ADDRESS,
    },
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon ETH Delta Vault (Call)`,
    tokenName: "Ribbon ETH Delta Vault",
    tokenSymbol: "rETH-DELTA",
    asset: WETH_ADDRESS,
    assetContractName: "IWETH",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: WETH_ADDRESS,
    chainlinkPricer: CHAINLINK_WETH_PRICER,
    deltaFirstOption: BigNumber.from("1000"),
    deltaSecondOption: BigNumber.from("1000"),
    deltaStep: BigNumber.from("100"),
    depositAmount: parseEther("1"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("100000000"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("2000000"),
    performanceFee: BigNumber.from("20000000"),
    optionAllocationPct: BigNumber.from("500"),
    optionPremium: BigNumber.from("10").mul(BigNumber.from("10").pow("18")),
    auctionDuration: 21600,
    tokenDecimals: 18,
    isPut: false,
    gasLimits: {
      depositWorstCase: 101000,
      depositBestCase: 90000,
    },
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon WBTC Delta Vault (Put)`,
    tokenName: "Ribbon BTC Delta Vault Put",
    tokenSymbol: "rWBTC-DELTA-P",
    asset: WBTC_ADDRESS,
    assetContractName: "IERC20",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: USDC_ADDRESS,
    chainlinkPricer: CHAINLINK_WBTC_PRICER,
    deltaFirstOption: BigNumber.from("1000"),
    deltaSecondOption: BigNumber.from("1000"),
    deltaStep: BigNumber.from("1000"),
    tokenDecimals: 6,
    depositAmount: BigNumber.from("100000000"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("2000000"),
    performanceFee: BigNumber.from("20000000"),
    optionAllocationPct: BigNumber.from("500"),
    optionPremium: BigNumber.from("1000").mul(BigNumber.from("10").pow("6")),
    minimumSupply: BigNumber.from("10").pow("3").toString(),
    expectedMintAmount: BigNumber.from("370370"),
    auctionDuration: 21600,
    isPut: true,
    gasLimits: {
      depositWorstCase: 115000,
      depositBestCase: 98000,
    },
    mintConfig: {
      contractOwnerAddress: USDC_OWNER_ADDRESS,
    },
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon ETH Delta Vault (Put) `,
    tokenName: "Ribbon ETH Delta Vault Put",
    tokenSymbol: "rETH-DELTA-P",
    asset: WETH_ADDRESS,
    assetContractName: "IERC20",
    strikeAsset: USDC_ADDRESS,
    collateralAsset: USDC_ADDRESS,
    chainlinkPricer: CHAINLINK_WETH_PRICER,
    deltaFirstOption: BigNumber.from("1000"),
    deltaSecondOption: BigNumber.from("1000"),
    deltaStep: BigNumber.from("100"),
    depositAmount: BigNumber.from("100000000000"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("2000000"),
    performanceFee: BigNumber.from("20000000"),
    optionAllocationPct: BigNumber.from("500"),
    optionPremium: BigNumber.from("1000").mul(BigNumber.from("10").pow("6")),
    minimumSupply: BigNumber.from("10").pow("3").toString(),
    expectedMintAmount: BigNumber.from("5263157894"),
    auctionDuration: 21600,
    tokenDecimals: 6,
    isPut: true,
    gasLimits: {
      depositWorstCase: 115000,
      depositBestCase: 98000,
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
 * @param {string} params.chainlinkPricer - Address of chainlink pricer
 * @param {BigNumber} params.deltaFirstOption - Delta of first option
 * @param {BigNumber} params.deltaSecondOption - Delta of second option
 * @param {BigNumber} params.deltaStep - Step to use for iterating over strike prices and corresponding deltas
 * @param {Object=} params.mintConfig - Optional: For minting asset, if asset can be minted
 * @param {string} params.mintConfig.contractOwnerAddress - Impersonate address of mintable asset contract owner
 * @param {BigNumber} params.depositAmount - Deposit amount
 * @param {string} params.minimumSupply - Minimum supply to maintain for share and asset balance
 * @param {string} params.intialSharePrice - Round 1 asset/share price
 * @param {BigNumber} params.expectedMintAmount - Expected oToken amount to be minted with our deposit
 * @param {number} params.auctionDuration - Duration of gnosis auction in seconds
 * @param {BigNumber} params.premiumDiscount - Premium discount of the sold options to incentivize arbitraguers (thousandths place: 000 - 999)
 * @param {BigNumber} params.optionAllocationPct - Percentage of funds to allocate towards options purchase that week
 * @param {BigNumber} params.optionPremium - Premium to pay per oToken
 * @param {BigNumber} params.managementFee - Management fee (6 decimals)
 * @param {BigNumber} params.performanceFee - PerformanceFee fee (6 decimals)
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
  chainlinkPricer: string;
  deltaFirstOption: BigNumber;
  deltaSecondOption: BigNumber;
  deltaStep: BigNumber;
  depositAmount: BigNumber;
  minimumSupply: string;
  expectedMintAmount: BigNumber;
  premiumDiscount: BigNumber;
  managementFee: BigNumber;
  performanceFee: BigNumber;
  optionAllocationPct: BigNumber;
  optionPremium: BigNumber;
  auctionDuration: number;
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
  let owner: string, user: string, feeRecipient: string;

  // Signers
  let adminSigner: SignerWithAddress,
    userSigner: SignerWithAddress,
    ownerSigner: SignerWithAddress,
    feeRecipientSigner: SignerWithAddress;

  // Parameters
  let tokenName = params.tokenName;
  let tokenSymbol = params.tokenSymbol;
  let tokenDecimals = params.tokenDecimals;
  let minimumSupply = params.minimumSupply;
  let asset = params.asset;
  let collateralAsset = params.collateralAsset;
  let depositAmount = params.depositAmount;
  let premiumDiscount = params.premiumDiscount;
  let managementFee = params.managementFee;
  let performanceFee = params.performanceFee;
  let optionAllocationPct = params.optionAllocationPct;
  let optionPremium = params.optionPremium;
  // let expectedMintAmount = params.expectedMintAmount;
  let auctionDuration = params.auctionDuration;
  let isPut = params.isPut;

  // Contracts
  let strikeSelection: Contract;
  let volOracle: Contract;
  let optionsPremiumPricer: Contract;
  let gnosisAuction: Contract;
  let vaultLifecycleLib: Contract;
  let thetaVault: Contract;
  let vault: Contract;
  let oTokenFactory: Contract;
  let defaultOtoken: Contract;
  let assetContract: Contract;

  // Variables
  let defaultOtokenAddress: string;
  let firstOptionStrike: BigNumber;
  let firstOptionExpiry: number;
  let secondOptionStrike: BigNumber;
  let secondOptionExpiry: number;

  describe(`${params.name}`, () => {
    let initSnapshotId: string;
    let firstOption: Option;
    let secondOption: Option;

    const rollToNextOption = async () => {
      await thetaVault.connect(ownerSigner).commitAndClose();
      await time.increaseTo((await getNextOptionReadyAtTheta()) + 1);
      await vault.connect(ownerSigner).commitAndClose();
      await strikeSelection.setDelta(params.deltaFirstOption);
      await thetaVault.connect(ownerSigner).rollToNextOption();
      await time.increaseTo((await getNextOptionReadyAt()) + 1);
      await vault.connect(ownerSigner).rollToNextOption(optionPremium);
    };

    const rollToSecondOption = async (settlementPrice: BigNumber) => {
      const oracle = await setupOracle(params.chainlinkPricer, ownerSigner);

      await setOpynOracleExpiryPrice(
        params.asset,
        oracle,
        await getCurrentOptionExpiry(),
        settlementPrice
      );
      await strikeSelection.setDelta(params.deltaSecondOption);
      await thetaVault.connect(ownerSigner).commitAndClose();
      await time.increaseTo((await getNextOptionReadyAtTheta()) + 1);
      await vault.connect(ownerSigner).commitAndClose();
      await thetaVault.connect(ownerSigner).rollToNextOption();
      await time.increaseTo((await getNextOptionReadyAt()) + 1);
      await vault.connect(ownerSigner).rollToNextOption(optionPremium);
    };

    const getNextOptionReadyAt = async () => {
      const optionState = await vault.optionState();
      return optionState.nextOptionReadyAt;
    };

    const getNextOptionReadyAtTheta = async () => {
      const optionState = await thetaVault.optionState();
      return optionState.nextOptionReadyAt;
    };

    const rollToNextOptionSetup = async () => {
      await thetaVault.connect(ownerSigner).commitAndClose();

      await time.increaseTo((await getNextOptionReadyAtTheta()) + 1);

      await vault.connect(ownerSigner).commitAndClose();

      await thetaVault.connect(ownerSigner).rollToNextOption();
    };

    const getCurrentOptionExpiry = async () => {
      const currentOption = await thetaVault.currentOption();
      const otoken = await getContractAt("IOtoken", currentOption);
      return otoken.expiryTimestamp();
    };

    before(async function () {
      // Reset block
      await network.provider.request({
        method: "hardhat_reset",
        params: [
          {
            forking: {
              jsonRpcUrl: process.env.TEST_URI,
              blockNumber: 12529250,
            },
          },
        ],
      });

      initSnapshotId = await time.takeSnapshot();

      [adminSigner, ownerSigner, userSigner, feeRecipientSigner] =
        await ethers.getSigners();
      owner = ownerSigner.address;
      user = userSigner.address;
      owner = ownerSigner.address;
      feeRecipient = feeRecipientSigner.address;

      const TestVolOracle = await getContractFactory(
        TestVolOracle_ABI,
        TestVolOracle_BYTECODE,
        ownerSigner
      );

      const OptionsPremiumPricer = await getContractFactory(
        OptionsPremiumPricer_ABI,
        OptionsPremiumPricer_BYTECODE,
        ownerSigner
      );
      const StrikeSelection = await getContractFactory(
        "StrikeSelection",
        ownerSigner
      );

      volOracle = await TestVolOracle.deploy(PERIOD);

      optionsPremiumPricer = await OptionsPremiumPricer.deploy(
        params.asset === WETH_ADDRESS ? ethusdcPool : wbtcusdcPool,
        volOracle.address,
        params.asset === WETH_ADDRESS
          ? wethPriceOracleAddress
          : wbtcPriceOracleAddress,
        usdcPriceOracleAddress
      );

      strikeSelection = await StrikeSelection.deploy(
        optionsPremiumPricer.address,
        params.deltaFirstOption,
        params.deltaStep
      );

      const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
      vaultLifecycleLib = await VaultLifecycle.deploy();

      gnosisAuction = await getContractAt(
        "IGnosisAuction",
        GNOSIS_EASY_AUCTION
      );

      const thetaVaultInitializeArgs = [
        owner,
        feeRecipient,
        managementFee,
        performanceFee,
        tokenName,
        tokenSymbol,
        optionsPremiumPricer.address,
        strikeSelection.address,
        premiumDiscount,
        auctionDuration,
        [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS : asset,
          asset,
          minimumSupply,
          parseEther("500"),
        ],
      ];

      const thetaVaultDeployArgs = [
        WETH_ADDRESS,
        USDC_ADDRESS,
        OTOKEN_FACTORY,
        GAMMA_CONTROLLER,
        MARGIN_POOL,
        GNOSIS_EASY_AUCTION,
      ];

      thetaVault = (
        await deployProxy(
          "RibbonThetaVault",
          adminSigner,
          thetaVaultInitializeArgs,
          thetaVaultDeployArgs,
          {
            libraries: {
              VaultLifecycle: vaultLifecycleLib.address,
            },
          }
        )
      ).connect(userSigner);

      const initializeArgs = [
        owner,
        feeRecipient,
        managementFee,
        performanceFee,
        tokenName,
        tokenSymbol,
        thetaVault.address,
        optionAllocationPct,
        [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS : asset,
          asset,
          minimumSupply,
          parseEther("500"),
        ],
      ];

      const deployArgs = [
        WETH_ADDRESS,
        USDC_ADDRESS,
        GAMMA_CONTROLLER,
        MARGIN_POOL,
        GNOSIS_EASY_AUCTION,
      ];

      vault = (
        await deployProxy(
          "RibbonDeltaVault",
          adminSigner,
          initializeArgs,
          deployArgs,
          {
            libraries: {
              VaultLifecycle: vaultLifecycleLib.address,
            },
          }
        )
      ).connect(userSigner);

      // Update volatility
      await updateVol(params.asset);

      oTokenFactory = await getContractAt("IOtokenFactory", OTOKEN_FACTORY);

      await whitelistProduct(
        params.asset,
        params.strikeAsset,
        params.collateralAsset,
        params.isPut
      );

      const latestTimestamp = (await provider.getBlock("latest")).timestamp;

      // Create first option
      firstOptionExpiry = moment(latestTimestamp * 1000)
        .startOf("isoWeek")
        .add(1, "week")
        .day("friday")
        .hours(8)
        .minutes(0)
        .seconds(0)
        .unix();

      [firstOptionStrike] = await strikeSelection.getStrikePrice(
        firstOptionExpiry,
        params.isPut
      );

      const firstOptionAddress = await oTokenFactory.getTargetOtokenAddress(
        params.asset,
        params.strikeAsset,
        params.collateralAsset,
        firstOptionStrike,
        firstOptionExpiry,
        params.isPut
      );

      firstOption = {
        address: firstOptionAddress,
        strikePrice: firstOptionStrike,
        expiry: firstOptionExpiry,
      };

      // Create second option
      secondOptionExpiry = moment(latestTimestamp * 1000)
        .startOf("isoWeek")
        .add(2, "week")
        .day("friday")
        .hours(8)
        .minutes(0)
        .seconds(0)
        .unix();

      secondOptionStrike = firstOptionStrike.add(await strikeSelection.step());

      await strikeSelection.setDelta(params.deltaFirstOption);

      const secondOptionAddress = await oTokenFactory.getTargetOtokenAddress(
        params.asset,
        params.strikeAsset,
        params.collateralAsset,
        secondOptionStrike,
        secondOptionExpiry,
        params.isPut
      );

      secondOption = {
        address: secondOptionAddress,
        strikePrice: secondOptionStrike,
        expiry: secondOptionExpiry,
      };

      await thetaVault.initRounds(50);

      defaultOtokenAddress = firstOption.address;
      defaultOtoken = await getContractAt("IERC20", defaultOtokenAddress);
      assetContract = await getContractAt(
        params.assetContractName,
        collateralAsset
      );

      // If mintable token, then mine the token
      if (params.mintConfig) {
        const addressToDeposit = [userSigner, ownerSigner, adminSigner];

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

          await mintToken(
            assetContract,
            params.mintConfig.contractOwnerAddress,
            addressToDeposit[i].address,
            thetaVault.address,
            params.collateralAsset == USDC_ADDRESS
              ? BigNumber.from("10000000000000")
              : parseEther("200")
          );
        }
      } else if (params.asset === WETH_ADDRESS) {
        await assetContract
          .connect(userSigner)
          .deposit({ value: parseEther("100") });
      }
    });

    after(async () => {
      await time.revertToSnapShot(initSnapshotId);
    });

    describe("#initialize", () => {
      let testVault: Contract;

      time.revertToSnapshotAfterEach(async function () {
        const RibbonDeltaVault = await ethers.getContractFactory(
          "RibbonDeltaVault",
          {
            libraries: {
              VaultLifecycle: vaultLifecycleLib.address,
            },
          }
        );
        testVault = await RibbonDeltaVault.deploy(
          WETH_ADDRESS,
          USDC_ADDRESS,
          GAMMA_CONTROLLER,
          MARGIN_POOL,
          GNOSIS_EASY_AUCTION
        );
      });

      it("initializes with correct values", async function () {
        assert.equal((await vault.cap()).toString(), parseEther("500"));
        assert.equal(await vault.owner(), owner);
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
        assert.equal(await vault.WETH(), WETH_ADDRESS);
        assert.equal(await vault.USDC(), USDC_ADDRESS);
        assert.bnEqual(await vault.totalPending(), BigNumber.from(0));
        assert.equal(minimumSupply, params.minimumSupply);
        assert.equal(isPut, params.isPut);
        assert.equal(await vault.counterpartyThetaVault(), thetaVault.address);
        assert.bnEqual(cap, parseEther("500"));
        assert.equal(
          (await vault.optionAllocationPct()).toString(),
          optionAllocationPct.toString()
        );
      });

      it("cannot be initialized twice", async function () {
        await expect(
          vault.initialize(
            owner,
            feeRecipient,
            managementFee,
            performanceFee,
            tokenName,
            tokenSymbol,
            thetaVault.address,
            optionAllocationPct,
            [
              isPut,
              tokenDecimals,
              isPut ? USDC_ADDRESS : asset,
              asset,
              minimumSupply,
              parseEther("500"),
            ]
          )
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });

      it("reverts when initializing with 0 owner", async function () {
        await expect(
          testVault.initialize(
            constants.AddressZero,
            feeRecipient,
            managementFee,
            performanceFee,
            tokenName,
            tokenSymbol,
            thetaVault.address,
            optionAllocationPct,
            [
              isPut,
              tokenDecimals,
              isPut ? USDC_ADDRESS : asset,
              asset,
              minimumSupply,
              parseEther("500"),
            ]
          )
        ).to.be.revertedWith("!owner");
      });

      it("reverts when initializing with 0 feeRecipient", async function () {
        await expect(
          testVault.initialize(
            owner,
            constants.AddressZero,
            managementFee,
            performanceFee,
            tokenName,
            tokenSymbol,
            thetaVault.address,
            optionAllocationPct,
            [
              isPut,
              tokenDecimals,
              isPut ? USDC_ADDRESS : asset,
              asset,
              minimumSupply,
              parseEther("500"),
            ]
          )
        ).to.be.revertedWith("!feeRecipient");
      });

      it("reverts when initializing with 0 initCap", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            managementFee,
            performanceFee,
            tokenName,
            tokenSymbol,
            thetaVault.address,
            optionAllocationPct,
            [
              isPut,
              tokenDecimals,
              isPut ? USDC_ADDRESS : asset,
              asset,
              minimumSupply,
              0,
            ]
          )
        ).to.be.revertedWith("!cap");
      });

      it("reverts when asset is 0x", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            managementFee,
            performanceFee,
            tokenName,
            tokenSymbol,
            thetaVault.address,
            optionAllocationPct,
            [
              isPut,
              tokenDecimals,
              constants.AddressZero,
              asset,
              minimumSupply,
              parseEther("500"),
            ]
          )
        ).to.be.revertedWith("!asset");
      });

      it("reverts when minimumSupply is 0", async function () {
        await expect(
          testVault.initialize(
            owner,
            feeRecipient,
            managementFee,
            performanceFee,
            tokenName,
            tokenSymbol,
            thetaVault.address,
            optionAllocationPct,
            [
              isPut,
              tokenDecimals,
              isPut ? USDC_ADDRESS : asset,
              asset,
              0,
              parseEther("500"),
            ]
          )
        ).to.be.revertedWith("!minimumSupply");
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

    describe("#delay", () => {
      it("returns the delay", async function () {
        assert.equal((await vault.delay()).toNumber(), OPTION_DELAY);
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
          BigNumber.from("1000000")
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
            .withArgs(user, depositAmount, 1);

          assert.bnEqual(await vault.totalPending(), depositAmount);
          const { round, amount } = await vault.depositReceipts(user);
          assert.equal(round, 1);
          assert.bnEqual(amount, depositAmount);
        });

        it("fits gas budget [ @skip-on-coverage ]", async function () {
          const tx1 = await vault
            .connect(ownerSigner)
            .depositETH({ value: parseEther("0.1") });
          const receipt1 = await tx1.wait();
          assert.isAtMost(receipt1.gasUsed.toNumber(), 130000);

          const tx2 = await vault.depositETH({ value: parseEther("0.1") });
          const receipt2 = await tx2.wait();
          assert.isAtMost(receipt2.gasUsed.toNumber(), 91500);

          // Uncomment to measure precise gas numbers
          // console.log("Worst case depositETH", receipt1.gasUsed.toNumber());
          // console.log("Best case depositETH", receipt2.gasUsed.toNumber());
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
          const addressToDeposit = [userSigner, ownerSigner, adminSigner];

          for (let i = 0; i < addressToDeposit.length; i++) {
            const weth = assetContract.connect(addressToDeposit[i]);
            await weth.deposit({ value: parseEther("10") });
            await weth.approve(vault.address, parseEther("10"));
          }
        }
      });

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

      it("tops up existing deposit", async function () {
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

      it("fits gas budget for deposits [ @skip-on-coverage ]", async function () {
        await vault.connect(ownerSigner).deposit(depositAmount);

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

      it.skip("updates the previous deposit receipt", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount.mul(2));

        await vault.deposit(params.depositAmount);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(user);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, params.depositAmount);
        assert.bnEqual(unredeemedShares1, BigNumber.from(0));

        await rollToNextOption();

        const {
          round: round2,
          amount: amount2,
          unredeemedShares: unredeemedShares2,
        } = await vault.depositReceipts(user);

        assert.equal(round2, 1);
        assert.bnEqual(amount2, params.depositAmount);
        assert.bnEqual(unredeemedShares2, BigNumber.from(0));

        await vault.deposit(params.depositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          params.depositAmount
        );
        // vault will still hold the vault shares
        assert.bnEqual(await vault.balanceOf(vault.address), depositAmount);

        const {
          round: round3,
          amount: amount3,
          unredeemedShares: unredeemedShares3,
        } = await vault.depositReceipts(user);

        assert.equal(round3, 2);
        assert.bnEqual(amount3, params.depositAmount);
        assert.bnEqual(unredeemedShares3, depositAmount);
      });
    });

    describe("#commitAndClose", () => {
      time.revertToSnapshotAfterEach();
      it("sets the next option and closes existing long", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await thetaVault.connect(ownerSigner).commitAndClose({ from: owner });

        const res = await vault
          .connect(ownerSigner)
          .commitAndClose({ from: owner });

        const receipt = await res.wait();
        const block = await provider.getBlock(receipt.blockNumber);

        const optionState = await vault.optionState();
        const vaultState = await vault.vaultState();

        assert.equal(optionState.nextOption, defaultOtokenAddress);
        assert.equal(
          optionState.nextOptionReadyAt,
          block.timestamp + OPTION_DELAY
        );
        assert.isTrue(vaultState.lockedAmount.isZero());
        assert.equal(optionState.currentOption, constants.AddressZero);
      });

      it("should set the next option twice", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await thetaVault.connect(ownerSigner).commitAndClose();
        await vault.connect(ownerSigner).commitAndClose();
        await thetaVault.connect(ownerSigner).commitAndClose();
        await vault.connect(ownerSigner).commitAndClose();
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);
        await thetaVault.connect(ownerSigner).commitAndClose();
        const res = await vault
          .connect(ownerSigner)
          .commitAndClose({ from: owner });

        const receipt = await res.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 1220000);
      });
    });

    describe("#rollToNextOption", () => {
      let oracle: Contract;

      const depositAmount = params.depositAmount;

      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(params.collateralAsset, vault, depositAmount);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          depositAmount
        );

        oracle = await setupOracle(params.chainlinkPricer, ownerSigner);
      });

      it("reverts when delay not passed", async function () {
        await rollToNextOptionSetup();

        // will revert when trying to roll immediately
        await expect(
          vault.connect(ownerSigner).rollToNextOption(optionPremium)
        ).to.be.revertedWith("!ready");

        await time.increaseTo((await getNextOptionReadyAt()) - 100);

        await expect(
          vault.connect(ownerSigner).rollToNextOption(optionPremium)
        ).to.be.revertedWith("!ready");
      });

      it("places bid on oTokens and gains possession after auction settlement", async function () {
        let startGnosisBalance = await assetContract.balanceOf(
          GNOSIS_EASY_AUCTION
        );

        await rollToNextOptionSetup();

        await time.increaseTo((await getNextOptionReadyAt()) + 1);

        let bidAmount = (await lockedBalanceForRollover(assetContract, vault))
          .mul(await vault.optionAllocationPct())
          .div(BigNumber.from(10000));

        let numOTokens = bidAmount
          .mul(BigNumber.from(10).pow(tokenDecimals))
          .div(optionPremium)
          .mul(BigNumber.from(10).pow(8))
          .div(BigNumber.from(10).pow(tokenDecimals));

        const res = await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        await expect(res).to.not.emit(vault, "CloseLong");

        await expect(res)
          .to.emit(vault, "OpenLong")
          .withArgs(defaultOtokenAddress, numOTokens, bidAmount, owner);

        assert.equal(
          (await vault.balanceBeforePremium()).toString(),
          depositAmount
        );

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          (await vault.balanceBeforePremium()).sub(bidAmount)
        );

        assert.bnEqual(
          await defaultOtoken.balanceOf(GNOSIS_EASY_AUCTION),
          params.expectedMintAmount
        );

        assert.equal(
          (await assetContract.balanceOf(GNOSIS_EASY_AUCTION))
            .sub(startGnosisBalance)
            .toString(),
          bidAmount.toString()
        );

        assert.equal(await vault.currentOption(), defaultOtokenAddress);

        await time.increaseTo(
          (await time.now()).toNumber() +
            (await thetaVault.auctionDuration()).toNumber() +
            1
        );

        await closeAuctionAndClaim(
          gnosisAuction,
          thetaVault,
          vault,
          userSigner.address
        );

        // Received at least as many as requested.
        assert.bnEqual(
          await defaultOtoken.balanceOf(vault.address),
          params.expectedMintAmount
        );
      });

      it("reverts when calling before expiry", async function () {
        const firstOptionAddress = firstOption.address;
        let startAssetBalance = await assetContract.balanceOf(vault.address);

        await rollToNextOptionSetup();

        await time.increaseTo((await getNextOptionReadyAt()) + 1);

        let bidAmount = (await lockedBalanceForRollover(assetContract, vault))
          .mul(await vault.optionAllocationPct())
          .div(BigNumber.from(10000));

        let numOTokens = bidAmount
          .mul(BigNumber.from(10).pow(tokenDecimals))
          .div(optionPremium)
          .mul(BigNumber.from(10).pow(8))
          .div(BigNumber.from(10).pow(tokenDecimals));

        const firstTx = await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        await expect(firstTx)
          .to.emit(vault, "OpenLong")
          .withArgs(firstOptionAddress, numOTokens, bidAmount, owner);

        // optionAllocationPct % of the vault's balance is allocated to long
        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          startAssetBalance.sub(bidAmount)
        );

        await expect(
          thetaVault.connect(ownerSigner).commitAndClose()
        ).to.be.revertedWith(
          "Controller: can not settle vault with un-expired otoken"
        );

        await expect(
          vault.connect(ownerSigner).commitAndClose()
        ).to.be.revertedWith("!thetavaultclosed");
      });

      it("exercises and roll funds into next option, after expiry ITM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;
        let startAssetBalance = await assetContract.balanceOf(vault.address);
        let startGnosisBalance = await assetContract.balanceOf(
          GNOSIS_EASY_AUCTION
        );

        await rollToNextOptionSetup();

        await time.increaseTo((await getNextOptionReadyAt()) + 1);

        let bidAmount = (await lockedBalanceForRollover(assetContract, vault))
          .mul(await vault.optionAllocationPct())
          .div(BigNumber.from(10000));

        let numOTokens = bidAmount
          .mul(BigNumber.from(10).pow(tokenDecimals))
          .div(optionPremium)
          .mul(BigNumber.from(10).pow(8))
          .div(BigNumber.from(10).pow(tokenDecimals));

        const firstTx = await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        assert.equal(await vault.currentOption(), firstOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), firstOption.expiry);

        await expect(firstTx)
          .to.emit(vault, "OpenLong")
          .withArgs(firstOptionAddress, numOTokens, bidAmount, owner);

        // balance should be everything minus premium
        assert.equal(
          (await assetContract.balanceOf(vault.address)).toString(),
          startAssetBalance
            .sub(
              (await assetContract.balanceOf(GNOSIS_EASY_AUCTION)).sub(
                startGnosisBalance
              )
            )
            .toString()
        );

        await time.increaseTo(
          (await time.now()).toNumber() +
            (await thetaVault.auctionDuration()).toNumber() +
            1
        );

        await closeAuctionAndClaim(
          gnosisAuction,
          thetaVault,
          vault,
          userSigner.address
        );

        // oToken balance should increase
        assert.bnEqual(
          await defaultOtoken.balanceOf(vault.address),
          params.expectedMintAmount
        );

        let diff =
          params.asset === WETH_ADDRESS
            ? BigNumber.from("1000").mul(BigNumber.from("10").pow("8"))
            : BigNumber.from("10000").mul(BigNumber.from("10").pow("8"));

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(diff)
          : firstOptionStrike.add(diff);

        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceITM
        );

        // exercise because it's ITM
        const beforeBalance = await assetContract.balanceOf(vault.address);

        await thetaVault
          .connect(ownerSigner)
          .setStrikePrice(secondOptionStrike);

        await thetaVault.connect(ownerSigner).commitAndClose();

        let firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

        const afterBalance = await assetContract.balanceOf(vault.address);

        // test that the vault's balance increased after closing short when ITM
        assert.isBelow(
          parseInt(depositAmount.toString()),
          parseInt(afterBalance)
        );

        await expect(firstCloseTx)
          .to.emit(vault, "CloseLong")
          .withArgs(
            firstOptionAddress,
            BigNumber.from(afterBalance).sub(beforeBalance),
            owner
          );

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const currBalance = await assetContract.balanceOf(vault.address);

        let pendingAmount = (await vault.vaultState()).totalPending;

        let secondInitialLockedBalance = await lockedBalanceForRollover(
          assetContract,
          vault
        );

        // Management / Performance fee is included because net positive on week

        let vaultFees = secondInitialLockedBalance
          .mul(await vault.managementFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));
        vaultFees = vaultFees.add(
          secondInitialLockedBalance
            .sub((await vault.vaultState()).lastLockedAmount)
            .sub(pendingAmount)
            .mul(await vault.performanceFee())
            .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
        );

        let newBidAmount = secondInitialLockedBalance
          .sub(vaultFees)
          .mul(await vault.optionAllocationPct())
          .div(BigNumber.from(10000));

        let newNumOTokens = newBidAmount
          .mul(BigNumber.from(10).pow(tokenDecimals))
          .div(optionPremium)
          .mul(BigNumber.from(10).pow(8))
          .div(BigNumber.from(10).pow(tokenDecimals));

        await thetaVault.connect(ownerSigner).rollToNextOption();

        const secondTx = await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        assert.equal(await vault.currentOption(), secondOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);

        await expect(secondTx)
          .to.emit(vault, "OpenLong")
          .withArgs(secondOptionAddress, newNumOTokens, newBidAmount, owner);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          currBalance.sub(newBidAmount).sub(vaultFees)
        );
      });

      it("withdraws and roll funds into next option, after expiry OTM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;
        let startAssetBalance = await assetContract.balanceOf(vault.address);
        let startGnosisBalance = await assetContract.balanceOf(
          GNOSIS_EASY_AUCTION
        );

        await rollToNextOptionSetup();

        await time.increaseTo((await getNextOptionReadyAt()) + 1);

        let bidAmount = (await lockedBalanceForRollover(assetContract, vault))
          .mul(await vault.optionAllocationPct())
          .div(BigNumber.from(10000));

        let numOTokens = bidAmount
          .mul(BigNumber.from(10).pow(tokenDecimals))
          .div(optionPremium)
          .mul(BigNumber.from(10).pow(8))
          .div(BigNumber.from(10).pow(tokenDecimals));

        const firstTx = await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        assert.equal(await vault.currentOption(), firstOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), firstOption.expiry);

        await expect(firstTx)
          .to.emit(vault, "OpenLong")
          .withArgs(firstOptionAddress, numOTokens, bidAmount, owner);

        // balance should be everything minus premium
        assert.equal(
          (await assetContract.balanceOf(vault.address)).toString(),
          startAssetBalance
            .sub(
              (await assetContract.balanceOf(GNOSIS_EASY_AUCTION)).sub(
                startGnosisBalance
              )
            )
            .toString()
        );

        await time.increaseTo(
          (await time.now()).toNumber() +
            (await thetaVault.auctionDuration()).toNumber() +
            1
        );

        await closeAuctionAndClaim(
          gnosisAuction,
          thetaVault,
          vault,
          userSigner.address
        );

        // oToken balance should increase
        assert.bnEqual(
          await defaultOtoken.balanceOf(vault.address),
          params.expectedMintAmount
        );

        let diff =
          params.asset === WETH_ADDRESS
            ? BigNumber.from("1000").mul(BigNumber.from("10").pow("8"))
            : BigNumber.from("10000").mul(BigNumber.from("10").pow("8"));

        const settlementPriceOTM = isPut
          ? firstOptionStrike.add(diff)
          : firstOptionStrike.sub(diff);

        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceOTM
        );

        // expires worthless because it is OTM

        const beforeBalance = await assetContract.balanceOf(vault.address);

        await thetaVault
          .connect(ownerSigner)
          .setStrikePrice(secondOptionStrike);

        await thetaVault.connect(ownerSigner).commitAndClose();

        let firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

        const afterBalance = await assetContract.balanceOf(vault.address);

        // test that the vault's balance decreased after closing short when OTM
        assert.isAbove(
          parseInt(depositAmount.toString()),
          parseInt(afterBalance)
        );

        await expect(firstCloseTx)
          .to.emit(vault, "CloseLong")
          .withArgs(
            firstOptionAddress,
            BigNumber.from(afterBalance).sub(beforeBalance),
            owner
          );

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const currBalance = await assetContract.balanceOf(vault.address);

        let newBidAmount = (
          await lockedBalanceForRollover(assetContract, vault)
        )
          .mul(await vault.optionAllocationPct())
          .div(BigNumber.from(10000));

        let newNumOTokens = newBidAmount
          .mul(BigNumber.from(10).pow(tokenDecimals))
          .div(optionPremium)
          .mul(BigNumber.from(10).pow(8))
          .div(BigNumber.from(10).pow(tokenDecimals));

        let secondInitialLockedBalance = await lockedBalanceForRollover(
          assetContract,
          vault
        );

        await thetaVault.connect(ownerSigner).rollToNextOption();

        const secondTx = await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        // Vault fees are 0 because vault is negative on the week
        let vaultFees = 0;

        assert.equal(
          secondInitialLockedBalance
            .sub(await vault.balanceBeforePremium())
            .toString(),
          vaultFees.toString()
        );

        assert.equal(await vault.currentOption(), secondOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);

        await expect(secondTx)
          .to.emit(vault, "OpenLong")
          .withArgs(
            secondOptionAddress,
            newNumOTokens,
            newBidAmount.sub(vaultFees),
            owner
          );

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          currBalance.sub(newBidAmount).sub(vaultFees)
        );
      });

      it("is not able to roll to new option consecutively without setNextOption", async function () {
        await thetaVault.connect(ownerSigner).commitAndClose();
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await thetaVault.connect(ownerSigner).rollToNextOption();
        await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        await expect(
          vault.connect(ownerSigner).rollToNextOption(optionPremium.toString())
        ).to.be.revertedWith("!nextOption");
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await thetaVault.connect(ownerSigner).commitAndClose();
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await thetaVault.connect(ownerSigner).rollToNextOption();
        const tx = await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());
        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 910000);
        // console.log("rollToNextOption", receipt.gasUsed.toNumber());
      });
    });

    describe("#claimAuctionOtokens", () => {
      const depositAmount = params.depositAmount;

      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(params.collateralAsset, vault, depositAmount);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          depositAmount
        );
      });

      it("claims the tokens for the delta vault", async function () {
        await rollToNextOptionSetup();

        await time.increaseTo((await getNextOptionReadyAt()) + 1);

        await vault
          .connect(ownerSigner)
          .rollToNextOption(optionPremium.toString());

        await time.increaseTo(
          (await time.now()).toNumber() +
            (await thetaVault.auctionDuration()).toNumber() +
            1
        );

        await gnosisAuction
          .connect(userSigner)
          .settleAuction(await thetaVault.optionAuctionID());

        let oTokenBalanceBefore = await defaultOtoken.balanceOf(vault.address);
        await vault.claimAuctionOtokens();
        let oTokenBalanceAfter = await defaultOtoken.balanceOf(vault.address);

        assert.bnGt(oTokenBalanceAfter, oTokenBalanceBefore);
      });
    });

    describe("#assetBalance", () => {
      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(
          params.collateralAsset,
          vault,
          params.depositAmount
        );

        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          params.depositAmount
        );

        await rollToNextOption();
      });

      it("returns the new deposit + old deposit - premium", async function () {
        const newDepositAmount = BigNumber.from("1000000000000");
        await depositIntoVault(params.collateralAsset, vault, newDepositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          newDepositAmount
            .add(params.depositAmount)
            .sub(
              params.depositAmount
                .mul(params.optionAllocationPct)
                .div(BigNumber.from("10000"))
            )
        );
      });
    });

    describe("#maxRedeem", () => {
      let oracle: Contract;

      time.revertToSnapshotAfterEach(async function () {
        oracle = await setupOracle(params.chainlinkPricer, ownerSigner);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          params.depositAmount
        );
      });

      it("is able to redeem deposit at new price per share", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await rollToNextOption();

        const tx = await vault.maxRedeem();

        const balanceAfterOptionPurchase = params.depositAmount.sub(
          params.depositAmount
            .mul(params.optionAllocationPct)
            .div(BigNumber.from("10000"))
        );

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          balanceAfterOptionPurchase
        );
        assert.bnEqual(await vault.balanceOf(user), params.depositAmount);
        assert.bnEqual(await vault.balanceOf(vault.address), BigNumber.from(0));

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, params.depositAmount, 1);

        const { round, amount, unredeemedShares } = await vault.depositReceipts(
          user
        );

        assert.equal(round, 1);
        assert.bnEqual(amount, BigNumber.from(0));
        assert.bnEqual(unredeemedShares, BigNumber.from(0));
      });

      it("reverts when redeeming twice", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await rollToNextOption();

        await vault.maxRedeem();

        await expect(vault.maxRedeem()).to.be.revertedWith("!shares");
      });

      it("redeems after a deposit what was unredeemed from previous rounds", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount.mul(2));

        await vault.deposit(params.depositAmount);

        await rollToNextOption();

        await vault.deposit(params.depositAmount);

        const tx = await vault.maxRedeem();

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, params.depositAmount, 2);
      });

      it("is able to redeem deposit at correct pricePerShare after closing short in the money", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, params.depositAmount);

        // Mid-week deposit in round 1
        await assetContract
          .connect(userSigner)
          .transfer(owner, params.depositAmount);
        await vault.connect(ownerSigner).deposit(params.depositAmount);

        await thetaVault.connect(ownerSigner).commitAndClose();
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await thetaVault.connect(ownerSigner).rollToNextOption();
        await vault.connect(ownerSigner).rollToNextOption(optionPremium);
        await time.increaseTo(
          (await time.now()).toNumber() +
            (await thetaVault.auctionDuration()).toNumber() +
            1
        );
        await closeAuctionAndClaim(
          gnosisAuction,
          thetaVault,
          vault,
          userSigner.address
        );

        // Mid-week deposit in round 2
        await vault.connect(userSigner).deposit(params.depositAmount);

        const beforeBalance = await assetContract.balanceOf(vault.address);

        const beforePps = await vault.pricePerShare();

        let diff =
          params.asset === WETH_ADDRESS
            ? BigNumber.from("1000").mul(BigNumber.from("10").pow("8"))
            : BigNumber.from("10000").mul(BigNumber.from("10").pow("8"));

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(diff)
          : firstOptionStrike.add(diff);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceITM
        );

        await strikeSelection.setDelta(params.deltaSecondOption);
        await thetaVault.connect(ownerSigner).commitAndClose();
        await vault.connect(ownerSigner).commitAndClose();
        const afterBalance = await assetContract.balanceOf(vault.address);
        const afterPps = await vault.pricePerShare();
        const expectedMintAmountAfterLoss = params.depositAmount
          .mul(BigNumber.from(10).pow(params.tokenDecimals))
          .div(afterPps);

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await thetaVault.connect(ownerSigner).rollToNextOption();
        await vault.connect(ownerSigner).rollToNextOption(optionPremium);

        assert.bnGt(afterBalance, beforeBalance);
        assert.bnGt(afterPps, beforePps);

        // owner should lose money
        // User should not lose money
        // owner redeems the deposit from round 1 so there is a loss from ITM options
        const tx1 = await vault.connect(ownerSigner).maxRedeem();
        await expect(tx1)
          .to.emit(vault, "Redeem")
          .withArgs(owner, params.depositAmount, 1);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(owner);
        assert.equal(round1, 1);
        assert.bnEqual(amount1, BigNumber.from(0));
        assert.bnEqual(unredeemedShares1, BigNumber.from(0));
        assert.bnEqual(await vault.balanceOf(owner), params.depositAmount);

        // User deposit in round 2 so no loss
        // we should use the pps after the loss which is the lower pps
        const tx2 = await vault.connect(userSigner).maxRedeem();
        await expect(tx2)
          .to.emit(vault, "Redeem")
          .withArgs(user, expectedMintAmountAfterLoss, 2);

        const {
          round: round2,
          amount: amount2,
          unredeemedShares: unredeemedShares2,
        } = await vault.depositReceipts(user);
        assert.equal(round2, 2);
        assert.bnEqual(amount2, BigNumber.from(0));
        assert.bnEqual(unredeemedShares2, BigNumber.from(0));
        assert.bnEqual(
          await vault.balanceOf(user),
          expectedMintAmountAfterLoss
        );
      });
    });

    describe("#redeem", () => {
      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          depositAmount
        );
      });

      it("reverts when 0 passed", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await rollToNextOption();
        await expect(vault.redeem(0)).to.be.revertedWith("!shares");
      });

      it("overflows when shares >uint104", async function () {
        const redeemAmount = BigNumber.from(
          "340282366920938463463374607431768211455"
        );
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await rollToNextOption();
        await expect(vault.redeem(redeemAmount)).to.be.revertedWith(">U104");
      });

      it("reverts when redeeming more than available", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await expect(vault.redeem(depositAmount.add(1))).to.be.revertedWith(
          "Exceeds available"
        );
      });

      it("decreases unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const redeemAmount = BigNumber.from(1);
        const tx1 = await vault.redeem(redeemAmount);

        await expect(tx1)
          .to.emit(vault, "Redeem")
          .withArgs(user, redeemAmount, 1);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(user);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, BigNumber.from(0));
        assert.bnEqual(unredeemedShares1, depositAmount.sub(redeemAmount));

        const tx2 = await vault.redeem(depositAmount.sub(redeemAmount));

        await expect(tx2)
          .to.emit(vault, "Redeem")
          .withArgs(user, depositAmount.sub(redeemAmount), 1);

        const {
          round: round2,
          amount: amount2,
          unredeemedShares: unredeemedShares2,
        } = await vault.depositReceipts(user);

        assert.equal(round2, 1);
        assert.bnEqual(amount2, BigNumber.from(0));
        assert.bnEqual(unredeemedShares2, BigNumber.from(0));
      });
    });

    describe("#withdrawInstantly", () => {
      let depositAmountAfterPremium: BigNumber;

      time.revertToSnapshotAfterEach(async () => {
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          params.depositAmount
        );
        depositAmountAfterPremium = depositAmount.sub(
          depositAmount.mul(optionAllocationPct.div(100)).div(100)
        );
      });

      it("reverts when passed 0 shares", async function () {
        await expect(vault.withdrawInstantly(0)).to.be.revertedWith("!shares");
      });

      it("reverts when no deposit made", async function () {
        await expect(vault.withdrawInstantly(depositAmount)).to.be.revertedWith(
          "Insufficient balance"
        );
      });

      it("reverts when withdrawing more than vault + account balance", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        // Move 1 share into account
        await vault.redeem(depositAmount.div(2));

        await expect(
          vault.withdrawInstantly(depositAmount.add(1))
        ).to.be.revertedWith("Insufficient balance");
      });

      it("creates withdrawal from current round deposit", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        let vaultTokenBalanceBefore = await vault.totalSupply();

        await vault.withdrawInstantly(depositAmount);

        let vaultTokenBalanceAfter = await vault.totalSupply();

        assert.bnEqual(vaultTokenBalanceBefore, vaultTokenBalanceAfter);
      });

      it("creates withdrawal from unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await rollToNextOption();

        let startBalance: BigNumber;
        let withdrawAmount: BigNumber;
        if (collateralAsset === WETH_ADDRESS) {
          startBalance = await provider.getBalance(user);
        } else {
          startBalance = await assetContract.balanceOf(user);
        }

        const tx = await vault.withdrawInstantly(depositAmount);
        const receipt = await tx.wait();

        if (collateralAsset === WETH_ADDRESS) {
          const endBalance = await provider.getBalance(user);
          withdrawAmount = endBalance
            .sub(startBalance)
            .add(receipt.gasUsed.mul(gasPrice));
        } else {
          const endBalance = await assetContract.balanceOf(user);
          withdrawAmount = endBalance.sub(startBalance);
        }

        assert.bnGt(withdrawAmount, depositAmountAfterPremium.mul(99).div(100));
        assert.bnLt(
          withdrawAmount,
          depositAmountAfterPremium.mul(101).div(100)
        );

        let vaultTokenBalanceAfter = await vault.totalSupply();

        assert.equal(vaultTokenBalanceAfter.toString(), "0");

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, depositAmount, 1);

        await expect(tx)
          .to.emit(vault, "InstantWithdraw")
          .withArgs(user, depositAmount, 2);
      });

      it("creates withdrawal from redeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        // Move all shares into account
        await vault.redeem(depositAmount);

        const tx = await vault.withdrawInstantly(depositAmount);

        let vaultTokenBalanceAfter = await vault.totalSupply();

        assert.equal(vaultTokenBalanceAfter.toString(), "0");

        await expect(tx).to.not.emit(vault, "Redeem");

        await expect(tx)
          .to.emit(vault, "InstantWithdraw")
          .withArgs(user, depositAmount, 2);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const tx = await vault.withdrawInstantly(depositAmountAfterPremium);
        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 115000);
      });
    });

    describe("#initiateWithdraw", () => {
      let oracle: Contract;

      time.revertToSnapshotAfterEach(async () => {
        oracle = await setupOracle(params.chainlinkPricer, ownerSigner);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          params.depositAmount
        );
      });

      it("reverts when user initiates withdraws without any deposit", async function () {
        await expect(vault.initiateWithdraw(depositAmount)).to.be.revertedWith(
          "ERC20: transfer amount exceeds balance"
        );
      });

      it("reverts when passed 0 shares", async function () {
        await expect(vault.initiateWithdraw(0)).to.be.revertedWith("!shares");
      });

      it("reverts when withdrawing more than unredeemed balance", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await expect(
          vault.initiateWithdraw(depositAmount.add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when withdrawing more than vault + account balance", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        // Move 1 share into account
        await vault.redeem(1);

        await expect(
          vault.initiateWithdraw(depositAmount.add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when initiating with past existing withdrawal", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await vault.initiateWithdraw(depositAmount.div(2));

        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          firstOptionStrike
        );

        await rollToNextOption();

        await expect(
          vault.initiateWithdraw(depositAmount.div(2))
        ).to.be.revertedWith("Existing withdraw");
      });

      it("creates withdrawal from unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const tx = await vault.initiateWithdraw(depositAmount);

        await expect(tx)
          .to.emit(vault, "InitiateWithdraw")
          .withArgs(user, depositAmount, 2);

        await expect(tx)
          .to.emit(vault, "Transfer")
          .withArgs(vault.address, user, depositAmount);

        const { round, shares } = await vault.withdrawals(user);
        assert.equal(round, 2);
        assert.bnEqual(shares, depositAmount);
      });

      it("creates withdrawal by debiting user shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await vault.redeem(depositAmount.div(2));

        const tx = await vault.initiateWithdraw(depositAmount);

        await expect(tx)
          .to.emit(vault, "InitiateWithdraw")
          .withArgs(user, depositAmount, 2);

        // First we redeem the leftover amount
        await expect(tx)
          .to.emit(vault, "Transfer")
          .withArgs(vault.address, user, depositAmount.div(2));

        // Then we debit the shares from the user
        await expect(tx)
          .to.emit(vault, "Transfer")
          .withArgs(user, vault.address, depositAmount);

        assert.bnEqual(await vault.balanceOf(user), BigNumber.from(0));
        assert.bnEqual(await vault.balanceOf(vault.address), depositAmount);

        const { round, shares } = await vault.withdrawals(user);
        assert.equal(round, 2);
        assert.bnEqual(shares, depositAmount);
      });

      it("tops up existing withdrawal", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const tx1 = await vault.initiateWithdraw(depositAmount.div(2));

        // We redeem the full amount on the first initiateWithdraw
        await expect(tx1)
          .to.emit(vault, "Transfer")
          .withArgs(vault.address, user, depositAmount);
        await expect(tx1)
          .to.emit(vault, "Transfer")
          .withArgs(user, vault.address, depositAmount.div(2));

        const tx2 = await vault.initiateWithdraw(depositAmount.div(2));

        await expect(tx2)
          .to.emit(vault, "Transfer")
          .withArgs(user, vault.address, depositAmount.div(2));

        const { round, shares } = await vault.withdrawals(user);
        assert.equal(round, 2);
        assert.bnEqual(shares, depositAmount);
      });

      it("can initiate a withdrawal when there is a pending deposit", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount.mul(2));
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await vault.deposit(depositAmount);

        const tx = await vault.initiateWithdraw(depositAmount);

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, depositAmount, 2);
      });

      it("reverts when there is insufficient balance over multiple calls", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await vault.initiateWithdraw(depositAmount.div(2));

        await expect(
          vault.initiateWithdraw(depositAmount.div(2).add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const tx = await vault.initiateWithdraw(depositAmount);
        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 104000);
        // console.log("initiateWithdraw", receipt.gasUsed.toNumber());
      });
    });

    describe("#completeWithdraw", () => {
      time.revertToSnapshotAfterEach(async () => {
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          params.depositAmount
        );

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        await rollToNextOption();

        await vault.initiateWithdraw(depositAmount);
      });

      it("reverts when not initiated", async function () {
        await expect(
          vault.connect(ownerSigner).completeWithdraw()
        ).to.be.revertedWith("Not initiated");
      });

      it("reverts when round not closed", async function () {
        await expect(vault.completeWithdraw()).to.be.revertedWith(
          "Round not closed"
        );
      });

      it("reverts when calling completeWithdraw twice", async function () {
        await rollToSecondOption(firstOptionStrike);

        await vault.completeWithdraw();

        await expect(vault.completeWithdraw()).to.be.revertedWith(
          "Not initiated"
        );
      });

      it("completes the withdrawal", async function () {
        const firstStrikePrice = firstOptionStrike;
        const settlePriceITM = isPut
          ? firstStrikePrice.sub(100000000)
          : firstStrikePrice.add(100000000);

        await rollToSecondOption(settlePriceITM);

        const pricePerShare = await vault.roundPricePerShare(2);
        const withdrawAmount = depositAmount
          .mul(pricePerShare)
          .div(BigNumber.from(10).pow(await vault.decimals()));

        let beforeBalance: BigNumber;
        if (collateralAsset === WETH_ADDRESS) {
          beforeBalance = await provider.getBalance(user);
        } else {
          beforeBalance = await assetContract.balanceOf(user);
        }

        const tx = await vault.completeWithdraw({ gasPrice });
        const receipt = await tx.wait();
        const gasFee = receipt.gasUsed.mul(gasPrice);

        await expect(tx)
          .to.emit(vault, "Withdraw")
          .withArgs(user, withdrawAmount.toString(), depositAmount);

        if (collateralAsset !== WETH_ADDRESS) {
          const collateralERC20 = await getContractAt(
            "IERC20",
            collateralAsset
          );

          await expect(tx)
            .to.emit(collateralERC20, "Transfer")
            .withArgs(vault.address, user, withdrawAmount);
        }

        const { shares, round } = await vault.withdrawals(user);
        assert.equal(shares, 0);
        assert.equal(round, 2);

        let actualWithdrawAmount: BigNumber;
        if (collateralAsset === WETH_ADDRESS) {
          const afterBalance = await provider.getBalance(user);
          actualWithdrawAmount = afterBalance.sub(beforeBalance).add(gasFee);
        } else {
          const afterBalance = await assetContract.balanceOf(user);
          actualWithdrawAmount = afterBalance.sub(beforeBalance);
        }
        // Should be less because the pps is down
        assert.bnLt(actualWithdrawAmount, depositAmount);
        assert.bnEqual(actualWithdrawAmount, withdrawAmount);
      });
    });

    describe("#setOptionAllocation", () => {
      time.revertToSnapshotAfterEach();

      it("should revert if not owner", async function () {
        await expect(
          vault.connect(userSigner).setOptionAllocation(BigNumber.from("100"))
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should set the new option allocation percentage", async function () {
        await vault
          .connect(ownerSigner)
          .setOptionAllocation(BigNumber.from("100"));
        assert.bnEqual(
          BigNumber.from(await vault.optionAllocationPct()),
          BigNumber.from("100")
        );
      });
    });

    describe("#setCap", () => {
      time.revertToSnapshotAfterEach();

      it("should revert if not owner", async function () {
        await expect(
          vault.connect(userSigner).setCap(parseEther("10"))
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should set the new cap", async function () {
        await vault.connect(ownerSigner).setCap(parseEther("10"));
        assert.equal((await vault.cap()).toString(), parseEther("10"));
      });

      it("should revert when depositing over the cap", async function () {
        const capAmount = BigNumber.from("100000000");
        const depositAmount = BigNumber.from("10000000000");
        await vault.connect(ownerSigner).setCap(capAmount);

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

    describe("#shares", () => {
      time.revertToSnapshotAfterEach();

      it("shows correct share balance after redemptions", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          depositAmount
        );

        await rollToNextOption();

        assert.bnEqual(await vault.shares(user), depositAmount);

        const redeemAmount = BigNumber.from(1);
        await vault.redeem(redeemAmount);

        // Share balance should remain the same because the 1 share
        // is transferred to the user
        assert.bnEqual(await vault.shares(user), depositAmount);

        await vault.transfer(owner, redeemAmount);

        assert.bnEqual(
          await vault.shares(user),
          depositAmount.sub(redeemAmount)
        );
        assert.bnEqual(await vault.shares(owner), redeemAmount);
      });
    });

    describe("#shareBalances", () => {
      time.revertToSnapshotAfterEach();

      it("returns the share balances split", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          depositAmount
        );

        await rollToNextOption();

        const [heldByAccount1, heldByVault1] = await vault.shareBalances(user);
        assert.bnEqual(heldByAccount1, BigNumber.from(0));
        assert.bnEqual(heldByVault1, depositAmount);

        await vault.redeem(1);
        const [heldByAccount2, heldByVault2] = await vault.shareBalances(user);
        assert.bnEqual(heldByAccount2, BigNumber.from(1));
        assert.bnEqual(heldByVault2, depositAmount.sub(1));
      });
    });

    describe("#shares", () => {
      time.revertToSnapshotAfterEach();

      it("returns the total number of shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          depositAmount
        );

        await rollToNextOption();

        assert.bnEqual(await vault.shares(user), depositAmount);

        // Should remain the same after redemption because it's held on balanceOf
        await vault.redeem(1);
        assert.bnEqual(await vault.shares(user), depositAmount);
      });
    });

    describe("#accountVaultBalance", () => {
      time.revertToSnapshotAfterEach();

      it("returns a lesser underlying amount for user", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await depositIntoVault(
          params.collateralAsset,
          thetaVault,
          depositAmount
        );

        await rollToNextOption();

        assert.bnLt(await vault.accountVaultBalance(user), depositAmount);

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        // decreases after rollToNextOption and deposit
        assert.bnLt(await vault.accountVaultBalance(user), depositAmount);

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(100000000000)
          : firstOptionStrike.add(100000000000);

        await rollToSecondOption(settlementPriceITM);

        assert.bnLt(await vault.accountVaultBalance(user), depositAmount);
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

  const getTopOfPeriod = async () => {
    const latestTimestamp = (await provider.getBlock("latest")).timestamp;
    let topOfPeriod: number;

    const rem = latestTimestamp % PERIOD;
    if (rem < Math.floor(PERIOD / 2)) {
      topOfPeriod = latestTimestamp - rem + PERIOD;
    } else {
      topOfPeriod = latestTimestamp + rem + PERIOD;
    }
    return topOfPeriod;
  };

  const updateVol = async (asset: string) => {
    const values = [
      BigNumber.from("2000000000"),
      BigNumber.from("2100000000"),
      BigNumber.from("2200000000"),
      BigNumber.from("2150000000"),
      BigNumber.from("2250000000"),
      BigNumber.from("2350000000"),
      BigNumber.from("2450000000"),
      BigNumber.from("2550000000"),
      BigNumber.from("2350000000"),
      BigNumber.from("2450000000"),
      BigNumber.from("2250000000"),
      BigNumber.from("2250000000"),
      BigNumber.from("2650000000"),
    ];

    for (let i = 0; i < values.length; i++) {
      await volOracle.setPrice(values[i]);
      const topOfPeriod = (await getTopOfPeriod()) + PERIOD;
      await time.increaseTo(topOfPeriod);
      await volOracle.mockCommit(
        asset === WETH_ADDRESS ? ethusdcPool : wbtcusdcPool
      );
    }
  };
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

async function lockedBalanceForRollover(asset: Contract, vault: Contract) {
  let currentBalance = await asset.balanceOf(vault.address);
  let queuedWithdrawAmount =
    (await vault.totalSupply()) == 0
      ? 0
      : (await vault.vaultState()).queuedWithdrawShares
          .mul(currentBalance)
          .div(await vault.totalSupply());
  let balanceSansQueued = currentBalance.sub(queuedWithdrawAmount);
  return balanceSansQueued;
}
