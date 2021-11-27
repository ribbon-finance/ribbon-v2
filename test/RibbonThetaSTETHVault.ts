import hre, { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, constants, Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import OptionsPremiumPricer_ABI from "../constants/abis/OptionsPremiumPricer.json";
import TestVolOracle_ABI from "../constants/abis/TestVolOracle.json";
import moment from "moment-timezone";
import * as time from "./helpers/time";
import {
  CHAINLINK_WETH_PRICER_STETH,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  STETH_ADDRESS,
  WSTETH_ADDRESS,
  LDO_ADDRESS,
  STETH_ETH_CRV_POOL,
  WETH_ADDRESS,
  GNOSIS_EASY_AUCTION,
  WSTETH_PRICER,
  OptionsPremiumPricer_BYTECODE,
  TestVolOracle_BYTECODE,
} from "../constants/constants";
import {
  deployProxy,
  setupOracle,
  setOpynOracleExpiryPriceYearn,
  setAssetPricer,
  getAssetPricer,
  whitelistProduct,
  mintToken,
  bidForOToken,
  decodeOrder,
  lockedBalanceForRollover,
} from "./helpers/utils";
import { wmul } from "./helpers/math";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "./helpers/assertions";

const { provider, getContractAt, getContractFactory } = ethers;
const { parseEther } = ethers.utils;

moment.tz.setDefault("UTC");

const OPTION_DELAY = 15 * 60; // 15 minutes
const gasPrice = parseUnits("1", "gwei");
const FEE_SCALING = BigNumber.from(10).pow(6);
const WEEKS_PER_YEAR = 52142857;

const PERIOD = 43200; // 12 hours

const ethusdcPool = "0x8ad599c3A0ff1De082011EFDDc58f1908eb6e6D8";
const wbtcusdcPool = "0x99ac8ca7087fa4a2a1fb6357269965a2014abc35";

const wethPriceOracleAddress = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const wbtcPriceOracleAddress = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const usdcPriceOracleAddress = "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6";

const chainId = network.config.chainId;

describe("RibbonThetaSTETHVault", () => {
  behavesLikeRibbonOptionsVault({
    name: `Ribbon ETH Theta Vault - stETH (Call)`,
    tokenName: "Ribbon ETH Theta Vault stETH",
    tokenSymbol: "rSTETH-THETA",
    asset: WETH_ADDRESS[chainId],
    assetContractName: "IWETH",
    collateralContractName: "IWSTETH",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: WSTETH_ADDRESS,
    intermediaryAsset: STETH_ADDRESS,
    depositAsset: WETH_ADDRESS[chainId],
    collateralPricer: WSTETH_PRICER,
    underlyingPricer: CHAINLINK_WETH_PRICER_STETH,
    deltaFirstOption: BigNumber.from("1000"),
    deltaSecondOption: BigNumber.from("1000"),
    deltaStep: BigNumber.from("100"),
    depositAmount: parseEther("1"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("96511604"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("2000000"),
    performanceFee: BigNumber.from("20000000"),
    crvSlippage: BigNumber.from("1"),
    crvETHAmountAfterSlippage: BigNumber.from("998258752506440113"),
    auctionDuration: 21600,
    tokenDecimals: 18,
    isPut: false,
    gasLimits: {
      depositWorstCase: 173803,
      depositBestCase: 156881,
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
 * @param {string} params.assetContractName - Name of asset contract
 * @param {string} params.collateralContractName - Name of collateral asset contract
 * @param {string} params.strikeAsset - Address of strike assets
 * @param {string} params.collateralAsset - Address of asset used for collateral
 * @param {string} params.intermediaryAsset - Address of asset used as intermediary
 * @param {string} params.depositAsset - Address of asset used for deposits (unwrapped version of collateral asset)
 * @param {string} params.collateralPricer - Address of collateral pricer
 * @param {string} params.underlyingPricer - Address of underlying pricer
 * @param {BigNumber} params.deltaFirstOption - Delta of first option
 * @param {BigNumber} params.deltaSecondOption - Delta of second option
 * @param {BigNumber} params.deltaStep - Step to use for iterating over strike prices and corresponding deltas
 * @param {Object=} params.mintConfig - Optional: For minting asset, if asset can be minted
 * @param {string} params.mintConfig.contractOwnerAddress - Impersonate address of mintable asset contract owner
 * @param {BigNumber} params.depositAmount - Deposit amount
 * @param {string} params.minimumSupply - Minimum supply to maintain for share and asset balance
 * @param {BigNumber} params.expectedMintAmount - Expected oToken amount to be minted with our deposit
 * @param {number} params.auctionDuration - Duration of gnosis auction in seconds
 * @param {BigNumber} params.premiumDiscount - Premium discount of the sold options to incentivize arbitraguers (thousandths place: 000 - 999)
 * @param {BigNumber} params.managementFee - Management fee (6 decimals)
 * @param {BigNumber} params.performanceFee - PerformanceFee fee (6 decimals)
 * @param {BigNumber} params.crvSlippage - Slippage for steth -> eth swap
 * @param {BigNumber} params.crvETHAmountAfterSlippage - ETH returns after crv exchange
 * @param {boolean} params.isPut - Boolean flag for if the vault sells call or put options
 */
function behavesLikeRibbonOptionsVault(params: {
  name: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  asset: string;
  assetContractName: string;
  collateralContractName: string;
  depositAsset: string;
  strikeAsset: string;
  collateralAsset: string;
  intermediaryAsset: string;
  collateralPricer: string;
  underlyingPricer: string;
  deltaFirstOption: BigNumber;
  deltaSecondOption: BigNumber;
  deltaStep: BigNumber;
  depositAmount: BigNumber;
  minimumSupply: string;
  expectedMintAmount: BigNumber;
  auctionDuration: number;
  premiumDiscount: BigNumber;
  managementFee: BigNumber;
  performanceFee: BigNumber;
  crvSlippage: BigNumber;
  crvETHAmountAfterSlippage: BigNumber;
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
  let owner: string, keeper: string, user: string, feeRecipient: string;

  // Signers
  let adminSigner: SignerWithAddress,
    userSigner: SignerWithAddress,
    ownerSigner: SignerWithAddress,
    keeperSigner: SignerWithAddress,
    feeRecipientSigner: SignerWithAddress;

  // Parameters
  let tokenName = params.tokenName;
  let tokenSymbol = params.tokenSymbol;
  let tokenDecimals = params.tokenDecimals;
  let minimumSupply = params.minimumSupply;
  let asset = params.asset;
  let depositAsset = params.depositAsset;
  let collateralAsset = params.collateralAsset;
  let intermediaryAsset = params.intermediaryAsset;
  let depositAmount = params.depositAmount;
  let premiumDiscount = params.premiumDiscount;
  let managementFee = params.managementFee;
  let performanceFee = params.performanceFee;
  let crvSlippage = params.crvSlippage;
  let crvETHAmountAfterSlippage = params.crvETHAmountAfterSlippage;
  // let expectedMintAmount = params.expectedMintAmount;
  let auctionDuration = params.auctionDuration;
  let isPut = params.isPut;

  // Contracts
  let strikeSelection: Contract;
  let volOracle: Contract;
  let optionsPremiumPricer: Contract;
  let gnosisAuction: Contract;
  let vaultLifecycleSTETHLib: Contract;
  let vaultLifecycleLib: Contract;
  let vault: Contract;
  let oTokenFactory: Contract;
  let defaultOtoken: Contract;
  let assetContract: Contract;
  let collateralContract: Contract;
  let intermediaryAssetContract: Contract;
  let collateralPricerSigner: Contract;

  // Variables
  let defaultOtokenAddress: string;
  let firstOptionStrike: BigNumber;
  let firstOptionPremium: BigNumber;
  let firstOptionExpiry: number;
  let secondOptionStrike: BigNumber;
  let secondOptionExpiry: number;

  describe(`${params.name}`, () => {
    let initSnapshotId: string;
    let firstOption: Option;
    let secondOption: Option;

    const rollToNextOption = async () => {
      await vault.connect(ownerSigner).commitAndClose();
      await time.increaseTo((await getNextOptionReadyAt()) + 1);
      await strikeSelection.setDelta(params.deltaFirstOption);
      await vault.connect(keeperSigner).rollToNextOption();
    };

    const rollToSecondOption = async (settlementPrice: BigNumber) => {
      const oracle = await setupOracle(
        params.underlyingPricer,
        ownerSigner,
        true
      );

      await setOpynOracleExpiryPriceYearn(
        params.asset,
        oracle,
        settlementPrice,
        collateralPricerSigner,
        await getCurrentOptionExpiry()
      );
      await strikeSelection.setDelta(params.deltaSecondOption);
      await vault.connect(ownerSigner).commitAndClose();
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
      await vault.connect(keeperSigner).rollToNextOption();
    };

    const getNextOptionReadyAt = async () => {
      const optionState = await vault.optionState();
      return optionState.nextOptionReadyAt;
    };

    const getCurrentOptionExpiry = async () => {
      const currentOption = await vault.currentOption();
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
              blockNumber: 13056027,
            },
          },
        ],
      });

      initSnapshotId = await time.takeSnapshot();

      [adminSigner, ownerSigner, keeperSigner, userSigner, feeRecipientSigner] =
        await ethers.getSigners();
      owner = ownerSigner.address;
      user = userSigner.address;
      keeper = keeperSigner.address;
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

      volOracle = await TestVolOracle.deploy(PERIOD, 7);

      await volOracle.initPool(
        asset === WETH_ADDRESS[chainId] ? ethusdcPool : wbtcusdcPool
      );

      optionsPremiumPricer = await OptionsPremiumPricer.deploy(
        params.asset === WETH_ADDRESS[chainId] ? ethusdcPool : wbtcusdcPool,
        volOracle.address,
        params.asset === WETH_ADDRESS[chainId]
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

      const VaultLifecycleSTETH = await ethers.getContractFactory(
        "VaultLifecycleSTETH"
      );
      vaultLifecycleSTETHLib = await VaultLifecycleSTETH.deploy();

      gnosisAuction = await getContractAt(
        "IGnosisAuction",
        GNOSIS_EASY_AUCTION[chainId]
      );

      const initializeArgs = [
        owner,
        keeper,
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
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("500"),
        ],
      ];

      const deployArgs = [
        WETH_ADDRESS[chainId],
        USDC_ADDRESS[chainId],
        WSTETH_ADDRESS,
        LDO_ADDRESS,
        OTOKEN_FACTORY[chainId],
        GAMMA_CONTROLLER[chainId],
        MARGIN_POOL[chainId],
        GNOSIS_EASY_AUCTION[chainId],
        STETH_ETH_CRV_POOL,
      ];

      vault = (
        await deployProxy(
          "RibbonThetaSTETHVault",
          adminSigner,
          initializeArgs,
          deployArgs,
          {
            libraries: {
              VaultLifecycle: vaultLifecycleLib.address,
              VaultLifecycleSTETH: vaultLifecycleSTETHLib.address,
            },
          }
        )
      ).connect(userSigner);

      // Update volatility
      await updateVol(params.asset);

      oTokenFactory = await getContractAt(
        "IOtokenFactory",
        OTOKEN_FACTORY[chainId]
      );

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
        .add(1, "week")
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

      await vault.initRounds(50);

      defaultOtokenAddress = firstOption.address;
      defaultOtoken = await getContractAt("IERC20", defaultOtokenAddress);
      assetContract = await getContractAt(
        params.assetContractName,
        depositAsset
      );

      collateralContract = await getContractAt(
        params.collateralContractName,
        collateralAsset
      );

      intermediaryAssetContract = await getContractAt(
        "IERC20",
        intermediaryAsset
      );

      firstOptionPremium = BigNumber.from(
        wmul(
          await optionsPremiumPricer.getPremium(
            firstOptionStrike,
            firstOptionExpiry,
            params.isPut
          ),
          await collateralContract.stEthPerToken()
        )
      );

      await setAssetPricer(collateralAsset, params.collateralPricer, true);

      collateralPricerSigner = await getAssetPricer(
        params.collateralPricer,
        ownerSigner
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
            params.depositAsset === USDC_ADDRESS[chainId]
              ? BigNumber.from("10000000000000")
              : parseEther("200")
          );
        }
      } else if (params.asset === WETH_ADDRESS[chainId]) {
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
        const RibbonThetaVault = await ethers.getContractFactory(
          "RibbonThetaSTETHVault",
          {
            libraries: {
              VaultLifecycle: vaultLifecycleLib.address,
              VaultLifecycleSTETH: vaultLifecycleSTETHLib.address,
            },
          }
        );
        testVault = await RibbonThetaVault.deploy(
          WETH_ADDRESS[chainId],
          USDC_ADDRESS[chainId],
          WSTETH_ADDRESS,
          LDO_ADDRESS,
          OTOKEN_FACTORY[chainId],
          GAMMA_CONTROLLER[chainId],
          MARGIN_POOL[chainId],
          GNOSIS_EASY_AUCTION[chainId],
          STETH_ETH_CRV_POOL
        );
      });

      it("initializes with correct values", async function () {
        assert.equal((await vault.cap()).toString(), parseEther("500"));
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
        assert.equal(assetFromContract, depositAsset);
        assert.equal(collateralAsset, await vault.collateralToken());
        assert.equal(underlying, asset);
        assert.equal(await vault.WETH(), WETH_ADDRESS[chainId]);
        assert.equal(await vault.USDC(), USDC_ADDRESS[chainId]);
        assert.bnEqual(await vault.totalPending(), BigNumber.from(0));
        assert.equal(minimumSupply, params.minimumSupply);
        assert.equal(isPut, params.isPut);
        assert.equal(
          (await vault.premiumDiscount()).toString(),
          params.premiumDiscount.toString()
        );
        assert.bnEqual(cap, parseEther("500"));
        assert.equal(
          await vault.optionsPremiumPricer(),
          optionsPremiumPricer.address
        );
        assert.equal(await vault.strikeSelection(), strikeSelection.address);
        assert.equal(await vault.auctionDuration(), auctionDuration);
      });

      it("cannot be initialized twice", async function () {
        await expect(
          vault.initialize(
            owner,
            keeper,
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
              isPut ? USDC_ADDRESS[chainId] : asset,
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
            keeper,
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
              isPut ? USDC_ADDRESS[chainId] : asset,
              asset,
              minimumSupply,
              parseEther("500"),
            ]
          )
        ).to.be.revertedWith("!owner");
      });

      it("reverts when initializing with 0 keeper", async function () {
        await expect(
          testVault.initialize(
            owner,
            constants.AddressZero,
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
              isPut ? USDC_ADDRESS[chainId] : asset,
              asset,
              minimumSupply,
              parseEther("500"),
            ]
          )
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when initializing with 0 feeRecipient", async function () {
        await expect(
          testVault.initialize(
            owner,
            keeper,
            constants.AddressZero,
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
              isPut ? USDC_ADDRESS[chainId] : asset,
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
            keeper,
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
              isPut ? USDC_ADDRESS[chainId] : asset,
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
            keeper,
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
            keeper,
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
              isPut ? USDC_ADDRESS[chainId] : asset,
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
        assert.equal((await vault.DELAY()).toNumber(), OPTION_DELAY);
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

    describe("#auctionDuration", () => {
      it("returns the auction duration", async function () {
        assert.equal(
          (await vault.auctionDuration()).toString(),
          auctionDuration.toString()
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

    describe("#setAuctionDuration", () => {
      time.revertToSnapshotAfterTest();

      it("reverts when setting 10 seconds to setAuctionDuration", async function () {
        await expect(
          vault.connect(ownerSigner).setAuctionDuration("10")
        ).to.be.revertedWith("Invalid auction duration");
      });

      it("reverts when not owner call", async function () {
        await expect(
          vault.setAuctionDuration(BigNumber.from("10").toString())
        ).to.be.revertedWith("caller is not the owner");
      });

      it("changes the auction duration", async function () {
        await vault.connect(ownerSigner).setAuctionDuration("1000000");
        assert.equal((await vault.auctionDuration()).toString(), "1000000");
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

    describe("#setStrikeSelectionOrPricer", () => {
      time.revertToSnapshotAfterTest();

      it("set new strike selection contract to owner", async function () {
        assert.equal(await vault.strikeSelection(), strikeSelection.address);
        await vault
          .connect(ownerSigner)
          .setStrikeSelectionOrPricer(owner, true);
        assert.equal(await vault.strikeSelection(), owner);
      });

      it("set new options premium pricer contract to owner", async function () {
        assert.equal(
          await vault.optionsPremiumPricer(),
          optionsPremiumPricer.address
        );
        await vault
          .connect(ownerSigner)
          .setStrikeSelectionOrPricer(owner, false);
        assert.equal(await vault.optionsPremiumPricer(), owner);
      });

      it("reverts when not owner call", async function () {
        await expect(
          vault.setStrikeSelectionOrPricer(owner, true)
        ).to.be.revertedWith("caller is not the owner");
      });
    });

    describe("#collateralAsset", () => {
      it("returns the asset", async function () {
        assert.equal(await vault.collateralToken(), collateralAsset);
      });
    });

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
        assert.isAtMost(receipt1.gasUsed.toNumber(), 168247);

        const tx2 = await vault.depositETH({ value: parseEther("0.1") });
        const receipt2 = await tx2.wait();
        assert.isAtMost(receipt2.gasUsed.toNumber(), 137674);

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
        adminSigner.sendTransaction({
          to: vault.address,
          value: parseEther("10"),
        });

        await vault.connect(userSigner).depositETH({ value: parseEther("1") });

        assert.isTrue((await vault.balanceOf(user)).isZero());
      });

      it("reverts when minimum shares are not minted", async function () {
        await expect(
          vault.connect(userSigner).depositETH({
            value: BigNumber.from(minimumSupply).sub(1),
          })
        ).to.be.revertedWith("Insufficient balance");
      });
    });

    describe("#depositFor", () => {
      time.revertToSnapshotAfterEach();
      let creditor: String;

      beforeEach(async function () {
        creditor = ownerSigner.address.toString();
      });

      it("creates pending deposit successfully", async function () {
        const startBalance = await provider.getBalance(user);

        const depositAmount = parseEther("1");
        const tx = await vault.depositFor(creditor, {
          value: depositAmount,
          gasPrice,
        });
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
          .withArgs(creditor, depositAmount, 1);

        assert.bnEqual(await vault.totalPending(), depositAmount);
        const { round, amount } = await vault.depositReceipts(creditor);
        assert.equal(round, 1);
        assert.bnEqual(amount, depositAmount);
        const { round2, amount2 } = await vault.depositReceipts(user);
        await expect(round2).to.be.undefined;
        await expect(amount2).to.be.undefined;
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        const tx1 = await vault
          .connect(ownerSigner)
          .depositFor(creditor, { value: parseEther("0.1") });
        const receipt1 = await tx1.wait();
        assert.isAtMost(receipt1.gasUsed.toNumber(), 168247);

        const tx2 = await vault.depositFor(creditor, {
          value: parseEther("0.1"),
        });
        const receipt2 = await tx2.wait();
        assert.isAtMost(receipt2.gasUsed.toNumber(), 137674);

        // Uncomment to measure precise gas numbers
        // console.log("Worst case depositETH", receipt1.gasUsed.toNumber());
        // console.log("Best case depositETH", receipt2.gasUsed.toNumber());
      });

      it("reverts when no value passed", async function () {
        await expect(
          vault.connect(userSigner).depositFor(creditor, { value: 0 })
        ).to.be.revertedWith("!value");
      });

      it("does not inflate the share tokens on initialization", async function () {
        adminSigner.sendTransaction({
          to: vault.address,
          value: parseEther("10"),
        });

        await vault
          .connect(userSigner)
          .depositFor(creditor, { value: parseEther("1") });

        assert.isTrue((await vault.balanceOf(creditor)).isZero());
      });

      it("reverts when minimum shares are not minted", async function () {
        await expect(
          vault.connect(userSigner).depositFor(creditor, {
            value: BigNumber.from(minimumSupply).sub(1),
          })
        ).to.be.revertedWith("Insufficient balance");
      });
    });

    describe("#depositYieldToken", () => {
      time.revertToSnapshotAfterEach();
      let depositAmountInAsset;

      beforeEach(async function () {
        const addressToDeposit = [userSigner, ownerSigner, adminSigner];

        await setupYieldToken(
          addressToDeposit,
          intermediaryAsset,
          vault,
          params.depositAsset == WETH_ADDRESS[chainId]
            ? parseEther("7")
            : depositAmount.mul(3)
        );

        depositAmountInAsset = depositAmount.sub(1);
      });

      it("creates a pending deposit", async function () {
        const startBalance = await intermediaryAssetContract.balanceOf(user);

        const res = await vault.depositYieldToken(depositAmount);

        assert.bnEqual(
          await intermediaryAssetContract.balanceOf(user),
          startBalance.sub(depositAmount).add(1)
        );
        assert.isTrue((await vault.totalSupply()).isZero());
        assert.isTrue((await vault.balanceOf(user)).isZero());
        await expect(res)
          .to.emit(vault, "Deposit")
          .withArgs(user, depositAmountInAsset, 1);

        assert.bnEqual(await vault.totalPending(), depositAmountInAsset);
        const { round, amount } = await vault.depositReceipts(user);
        assert.equal(round, 1);
        assert.bnEqual(amount, depositAmountInAsset);
      });

      it("tops up existing deposit", async function () {
        const startBalance = await intermediaryAssetContract.balanceOf(user);

        await vault.depositYieldToken(depositAmount);

        const tx = await vault.depositYieldToken(depositAmount);

        assert.bnEqual(
          await intermediaryAssetContract.balanceOf(user),
          startBalance.sub(depositAmount.mul(2)).add(2)
        );
        assert.isTrue((await vault.totalSupply()).isZero());
        assert.isTrue((await vault.balanceOf(user)).isZero());
        await expect(tx)
          .to.emit(vault, "Deposit")
          .withArgs(user, depositAmountInAsset, 1);

        assert.bnEqual(
          await vault.totalPending(),
          depositAmountInAsset.mul(BigNumber.from(2))
        );
        const { round, amount } = await vault.depositReceipts(user);
        assert.equal(round, 1);
        assert.bnEqual(amount, depositAmountInAsset.mul(BigNumber.from(2)));
      });

      it("fits gas budget for deposits [ @skip-on-coverage ]", async function () {
        await vault.connect(ownerSigner).depositYieldToken(depositAmount);

        const tx1 = await vault.depositYieldToken(depositAmount);
        const receipt1 = await tx1.wait();
        assert.isAtMost(
          receipt1.gasUsed.toNumber(),
          params.gasLimits.depositWorstCase
        );

        const tx2 = await vault.depositYieldToken(depositAmount);
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

        await intermediaryAssetContract
          .connect(adminSigner)
          .transfer(vault.address, depositAmount);

        await vault
          .connect(userSigner)
          .depositYieldToken(BigNumber.from("10000000000"));

        // user needs to get back exactly 1 ether
        // even though the total has been incremented
        assert.isTrue((await vault.balanceOf(user)).isZero());
      });

      it("reverts when minimum shares are not minted", async function () {
        await expect(
          vault
            .connect(userSigner)
            .depositYieldToken(
              (await collateralContract.getWstETHByStETH(minimumSupply)).sub(1)
            )
        ).to.be.revertedWith("Insufficient balance");
      });

      it("updates the previous deposit receipt", async function () {
        await vault.depositYieldToken(params.depositAmount);

        await intermediaryAssetContract
          .connect(adminSigner)
          .transfer(vault.address, depositAmount);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(user);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, depositAmountInAsset);
        assert.bnEqual(unredeemedShares1, BigNumber.from(0));

        await rollToNextOption();

        const {
          round: round2,
          amount: amount2,
          unredeemedShares: unredeemedShares2,
        } = await vault.depositReceipts(user);

        assert.equal(round2, 1);
        assert.bnEqual(amount2, depositAmountInAsset);
        assert.bnEqual(unredeemedShares2, BigNumber.from(0));

        await vault.depositYieldToken(params.depositAmount);

        assert.bnEqual(
          await vault.balanceOf(vault.address),
          depositAmountInAsset
        );

        // vault will still hold the vault shares
        assert.bnEqual(
          await vault.balanceOf(vault.address),
          depositAmountInAsset
        );

        const {
          round: round3,
          amount: amount3,
          unredeemedShares: unredeemedShares3,
        } = await vault.depositReceipts(user);

        assert.equal(round3, 2);
        assert.bnEqual(amount3, depositAmountInAsset);
        assert.bnEqual(unredeemedShares3, depositAmountInAsset);
      });
    });

    describe("#commitAndClose", () => {
      time.revertToSnapshotAfterEach();

      it("sets the next option and closes existing short", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(params.depositAsset, vault, depositAmount);

        const res = await vault
          .connect(ownerSigner)
          .commitAndClose({ from: owner });

        const receipt = await res.wait();
        const block = await provider.getBlock(receipt.blockNumber);

        const optionState = await vault.optionState();
        const vaultState = await vault.vaultState();

        assert.equal(optionState.currentOption, constants.AddressZero);
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
        await depositIntoVault(params.depositAsset, vault, depositAmount);

        await vault.connect(ownerSigner).commitAndClose();

        await vault.connect(ownerSigner).commitAndClose();
      });

      it("sets the correct strike when overriding strike price", async function () {
        const newStrikePrice =
          params.asset === WETH_ADDRESS[chainId]
            ? BigNumber.from("250000000000")
            : BigNumber.from("4050000000000");

        await vault.connect(ownerSigner).setStrikePrice(newStrikePrice);

        assert.equal((await vault.lastStrikeOverrideRound()).toString(), "1");
        assert.equal(
          (await vault.overriddenStrikePrice()).toString(),
          newStrikePrice.toString()
        );

        await vault.connect(ownerSigner).commitAndClose({ from: owner });

        assert.equal(
          (
            await (
              await getContractAt("IOtoken", await vault.nextOption())
            ).strikePrice()
          ).toString(),
          newStrikePrice.toString()
        );

        const expiryTimestampOfNewOption = await (
          await getContractAt("IOtoken", await vault.nextOption())
        ).expiryTimestamp();

        assert.bnEqual(
          await vault.currentOtokenPremium(),
          wmul(
            (
              await optionsPremiumPricer.getPremium(
                newStrikePrice,
                expiryTimestampOfNewOption,
                params.isPut
              )
            )
              .mul(await vault.premiumDiscount())
              .div(1000),
            await collateralContract.stEthPerToken()
          )
        );
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(params.depositAsset, vault, depositAmount);
        const res = await vault
          .connect(ownerSigner)
          .commitAndClose({ from: owner });

        const receipt = await res.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 1169985);
        // console.log("commitAndClose", receipt.gasUsed.toNumber());
      });
    });

    describe("#burnRemainingOTokens", () => {
      time.revertToSnapshotAfterEach(async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(depositAsset, vault, depositAmount);
      });

      it("reverts when not called with keeper", async function () {
        await expect(
          vault.connect(userSigner).burnRemainingOTokens()
        ).to.be.revertedWith("!keeper");
      });

      it("burns all remaining oTokens", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await getNextOptionReadyAt()) + 1);

        await vault.connect(keeperSigner).rollToNextOption();

        let bidMultiplier = 2;

        const auctionDetails = await bidForOToken(
          gnosisAuction,
          assetContract,
          userSigner.address,
          defaultOtokenAddress,
          firstOptionPremium,
          tokenDecimals,
          bidMultiplier.toString(),
          auctionDuration
        );

        assert.equal(
          (await defaultOtoken.balanceOf(vault.address)).toString(),
          "0"
        );

        const assetBalanceBeforeSettle = await assetContract.balanceOf(
          vault.address
        );

        await gnosisAuction
          .connect(userSigner)
          .settleAuction(auctionDetails[0]);

        assert.isAbove(
          parseInt((await defaultOtoken.balanceOf(vault.address)).toString()),
          parseInt(
            params.expectedMintAmount
              .div(bidMultiplier)
              .mul(params.premiumDiscount.sub(1))
              .div(1000)
              .toString()
          )
        );

        assert.isAbove(
          parseInt((await assetContract.balanceOf(vault.address)).toString()),
          parseInt(
            (
              (assetBalanceBeforeSettle.add(BigNumber.from(auctionDetails[2])) *
                99) /
              100
            ).toString()
          )
        );

        const lockedAmountBeforeBurn = await collateralContract.balanceOf(
          vault.address
        );

        const assetBalanceAfterSettle = await collateralContract.balanceOf(
          vault.address
        );
        vault.connect(keeperSigner).burnRemainingOTokens();
        const assetBalanceAfterBurn = await collateralContract.balanceOf(
          vault.address
        );

        assert.isAbove(
          parseInt(assetBalanceAfterBurn.toString()),
          parseInt(
            assetBalanceAfterSettle
              .add(
                lockedAmountBeforeBurn
                  .div(bidMultiplier)
                  .mul(params.premiumDiscount.sub(1))
                  .div(1000)
              )
              .toString()
          )
        );
      });
    });

    describe("#rollToNextOption", () => {
      let oracle: Contract;
      const depositAmount = params.depositAmount;

      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(params.depositAsset, vault, depositAmount);

        oracle = await setupOracle(params.underlyingPricer, ownerSigner, true);
      });

      it("reverts when not called with keeper", async function () {
        await expect(
          vault.connect(ownerSigner).rollToNextOption()
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when delay not passed", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        // will revert when trying to roll immediately
        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!ready");

        time.increaseTo(
          (await vault.nextOptionReadyAt()).sub(BigNumber.from("1"))
        );

        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!ready");
      });

      it("mints oTokens and deposits collateral into vault", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const res = await vault.connect(keeperSigner).rollToNextOption();

        await expect(res).to.not.emit(vault, "CloseShort");

        await expect(res)
          .to.emit(vault, "OpenShort")
          .withArgs(
            defaultOtokenAddress,
            await collateralContract.balanceOf(MARGIN_POOL[chainId]),
            keeper
          );

        const vaultState = await vault.vaultState();

        assert.equal(vaultState.lockedAmount.toString(), depositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );

        assert.equal(
          (await collateralContract.balanceOf(vault.address)).toString(),
          "0"
        );

        assert.bnEqual(
          await defaultOtoken.balanceOf(GNOSIS_EASY_AUCTION[chainId]),
          params.expectedMintAmount
        );

        assert.equal(await vault.currentOption(), defaultOtokenAddress);
      });

      it("starts auction with correct parameters", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const nextOption = await getContractAt(
          "IOtoken",
          await vault.nextOption()
        );

        await vault.connect(keeperSigner).rollToNextOption();

        const currentAuctionCounter = await gnosisAuction.auctionCounter();
        const auctionDetails = await gnosisAuction.auctionData(
          currentAuctionCounter.toString()
        );
        const feeNumerator = await gnosisAuction.feeNumerator();
        const feeDenominator = await gnosisAuction.FEE_DENOMINATOR();

        assert.equal(auctionDetails.auctioningToken, defaultOtokenAddress);
        assert.equal(auctionDetails.biddingToken, depositAsset);
        assert.equal(
          auctionDetails.orderCancellationEndDate.toString(),
          (await time.now()).add(21600).toString()
        );
        assert.equal(
          auctionDetails.auctionEndDate.toString(),
          (await time.now()).add(21600).toString()
        );
        assert.equal(
          auctionDetails.minimumBiddingAmountPerOrder.toString(),
          "1"
        );
        assert.equal(auctionDetails.isAtomicClosureAllowed, false);
        assert.equal(
          auctionDetails.feeNumerator.toString(),
          feeNumerator.toString()
        );
        assert.equal(auctionDetails.minFundingThreshold.toString(), "0");
        assert.equal(
          await gnosisAuction.auctionAccessManager(currentAuctionCounter),
          constants.AddressZero
        );
        assert.equal(
          await gnosisAuction.auctionAccessData(currentAuctionCounter),
          "0x"
        );

        const initialAuctionOrder = decodeOrder(
          auctionDetails.initialAuctionOrder
        );

        const oTokenSellAmount = params.expectedMintAmount
          .mul(feeDenominator)
          .div(feeDenominator.add(feeNumerator));

        const oTokenPremium = wmul(
          (
            await optionsPremiumPricer.getPremium(
              await nextOption.strikePrice(),
              await nextOption.expiryTimestamp(),
              params.isPut
            )
          )
            .mul(await vault.premiumDiscount())
            .div(1000),
          await collateralContract.stEthPerToken()
        );

        assert.equal(
          initialAuctionOrder.sellAmount.toString(),
          oTokenSellAmount.toString()
        );
        assert.equal(
          initialAuctionOrder.buyAmount.toString(),
          wmul(oTokenSellAmount.mul(BigNumber.from(10).pow(10)), oTokenPremium)
            .div(BigNumber.from(10).pow(18 - tokenDecimals))
            .toString()
        );

        // Hardcoded
        // assert.equal(auctionDetails.interimSumBidAmount, 0);
        // assert.equal(auctionDetails.interimOrder, IterableOrderedOrderSet.QUEUE_START);
        // assert.equal(auctionDetails.clearingPriceOrder, bytes32(0));
        // assert.equal(auctionDetails.volumeClearingPriceOrder, 0);
        // assert.equal(auctionDetails.minFundingThresholdNotReached, false);
      });

      it("reverts when calling before expiry", async function () {
        const firstOptionAddress = firstOption.address;

        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(
            firstOptionAddress,
            await collateralContract.balanceOf(MARGIN_POOL[chainId]),
            keeper
          );

        // 100% of the vault's balance is allocated to short
        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );

        await expect(
          vault.connect(ownerSigner).commitAndClose()
        ).to.be.revertedWith("C31");
      });

      it("withdraws and roll funds into next option, after expiry ITM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        assert.equal(await vault.currentOption(), firstOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), firstOption.expiry);

        const depositAmountInAsset = await collateralContract.balanceOf(
          MARGIN_POOL[chainId]
        );

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmountInAsset, keeper);

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(1)
          : firstOptionStrike.add(1);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPriceYearn(
          params.asset,
          oracle,
          settlementPriceITM,
          collateralPricerSigner,
          await getCurrentOptionExpiry()
        );

        const beforeBalance = await collateralContract.balanceOf(vault.address);

        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

        const firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

        const afterBalance = await collateralContract.balanceOf(vault.address);

        // test that the vault's balance decreased after closing short when ITM
        assert.isAbove(
          parseInt(depositAmountInAsset.toString()),
          parseInt(BigNumber.from(afterBalance).sub(beforeBalance).toString())
        );

        await expect(firstCloseTx)
          .to.emit(vault, "CloseShort")
          .withArgs(
            firstOptionAddress,
            BigNumber.from(afterBalance).sub(beforeBalance),
            owner
          );

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const startBalance = await vault.totalBalance();

        let startMarginBalance = await collateralContract.balanceOf(
          MARGIN_POOL[chainId]
        );
        const secondTx = await vault.connect(keeperSigner).rollToNextOption();
        let endMarginBalance = await collateralContract.balanceOf(
          MARGIN_POOL[chainId]
        );

        assert.equal(await vault.currentOption(), secondOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);
        assert.equal(
          (await vault.vaultState()).lockedAmount.toString(),
          startBalance.toString()
        );

        await expect(secondTx)
          .to.emit(vault, "OpenShort")
          .withArgs(
            secondOptionAddress,
            endMarginBalance.sub(startMarginBalance),
            keeper
          );

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );
      });

      it("reverts when delay not passed", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        // will revert when trying to roll immediately
        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!ready");

        time.increaseTo(
          (await vault.nextOptionReadyAt()).sub(BigNumber.from("1"))
        );

        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!ready");
      });

      it("reverts when calling before expiry", async function () {
        const firstOptionAddress = firstOption.address;

        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(
            firstOptionAddress,
            await collateralContract.balanceOf(MARGIN_POOL[chainId]),
            keeper
          );

        // 100% of the vault's balance is allocated to short
        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );

        await expect(
          vault.connect(ownerSigner).commitAndClose()
        ).to.be.revertedWith("C31");
      });

      it("withdraws and roll funds into next option, after expiry OTM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(
            firstOptionAddress,
            await collateralContract.balanceOf(MARGIN_POOL[chainId]),
            keeper
          );

        let bidMultiplier = 1;

        const auctionDetails = await bidForOToken(
          gnosisAuction,
          assetContract,
          userSigner.address,
          defaultOtokenAddress,
          firstOptionPremium,
          tokenDecimals,
          bidMultiplier.toString(),
          auctionDuration
        );

        await gnosisAuction
          .connect(userSigner)
          .settleAuction(auctionDetails[0]);

        // only the premium should be left over because the funds are locked into Opyn
        assert.isAbove(
          parseInt((await assetContract.balanceOf(vault.address)).toString()),
          (parseInt(auctionDetails[2].toString()) * 99) / 100
        );

        const settlementPriceOTM = isPut
          ? firstOptionStrike.add(10000000000)
          : firstOptionStrike.sub(10000000000);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPriceYearn(
          params.asset,
          oracle,
          settlementPriceOTM,
          collateralPricerSigner,
          await getCurrentOptionExpiry()
        );

        const beforeBalance = await collateralContract.balanceOf(vault.address);

        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

        const firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

        const afterBalance = await collateralContract.balanceOf(vault.address);

        const depositAmountInAsset = await collateralContract.balanceOf(
          vault.address
        );

        // test that the vault's balance decreased after closing short when ITM
        assert.equal(
          parseInt(depositAmountInAsset.toString()),
          parseInt(BigNumber.from(afterBalance).sub(beforeBalance).toString())
        );

        await expect(firstCloseTx)
          .to.emit(vault, "CloseShort")
          .withArgs(
            firstOptionAddress,
            BigNumber.from(afterBalance).sub(beforeBalance),
            owner
          );

        // Time increase to after next option available
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        let pendingAmount = (await vault.vaultState()).totalPending;
        let [secondInitialLockedBalance, queuedWithdrawAmount] =
          await lockedBalanceForRollover(vault);

        let startMarginBalance = await collateralContract.balanceOf(
          MARGIN_POOL[chainId]
        );
        const secondTx = await vault.connect(keeperSigner).rollToNextOption();
        let endMarginBalance = await collateralContract.balanceOf(
          MARGIN_POOL[chainId]
        );

        let vaultFees = secondInitialLockedBalance
          .add(queuedWithdrawAmount)
          .sub(pendingAmount)
          .mul(await vault.managementFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));
        vaultFees = vaultFees.add(
          secondInitialLockedBalance
            .add(queuedWithdrawAmount)
            .sub((await vault.vaultState()).lastLockedAmount)
            .sub(pendingAmount)
            .mul(await vault.performanceFee())
            .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
        );

        assert.equal(
          secondInitialLockedBalance
            .sub((await vault.vaultState()).lockedAmount)
            .toString(),
          vaultFees.toString()
        );

        assert.equal(await vault.currentOption(), secondOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);
        assert.bnLt(
          (await vault.vaultState()).lockedAmount,
          depositAmount.add(auctionDetails[2]).sub(vaultFees).toString()
        );
        assert.bnGt(
          (await vault.vaultState()).lockedAmount,
          depositAmount
            .add(auctionDetails[2])
            .sub(vaultFees)
            .mul(99)
            .div(100)
            .toString()
        );

        await expect(secondTx)
          .to.emit(vault, "OpenShort")
          .withArgs(
            secondOptionAddress,
            endMarginBalance.sub(startMarginBalance),
            keeper
          );

        assert.equal(
          (await assetContract.balanceOf(vault.address)).toString(),
          BigNumber.from(0)
        );
      });

      it("withdraws and roll funds into next option, after expiry OTM (initiateWithdraw)", async function () {
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).rollToNextOption();

        let bidMultiplier = 1;

        const auctionDetails = await bidForOToken(
          gnosisAuction,
          assetContract,
          userSigner.address,
          defaultOtokenAddress,
          firstOptionPremium,
          tokenDecimals,
          bidMultiplier.toString(),
          auctionDuration
        );

        await gnosisAuction
          .connect(userSigner)
          .settleAuction(auctionDetails[0]);

        // only the premium should be left over because the funds are locked into Opyn
        assert.isAbove(
          parseInt((await assetContract.balanceOf(vault.address)).toString()),
          (parseInt(auctionDetails[2].toString()) * 99) / 100
        );

        const settlementPriceOTM = isPut
          ? firstOptionStrike.add(10000000000)
          : firstOptionStrike.sub(10000000000);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPriceYearn(
          params.asset,
          oracle,
          settlementPriceOTM,
          collateralPricerSigner,
          await getCurrentOptionExpiry()
        );

        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

        await vault.initiateWithdraw(params.depositAmount.div(2));

        await vault.connect(ownerSigner).commitAndClose();

        // Time increase to after next option available
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        let pendingAmount = (await vault.vaultState()).totalPending;
        let [secondInitialLockedBalance, queuedWithdrawAmount] =
          await lockedBalanceForRollover(vault);

        const secondStartBalance = await vault.totalBalance();

        await vault.connect(keeperSigner).rollToNextOption();

        let vaultFees = secondInitialLockedBalance
          .add(queuedWithdrawAmount)
          .sub(pendingAmount)
          .mul(await vault.managementFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));
        vaultFees = vaultFees.add(
          secondInitialLockedBalance
            .add(queuedWithdrawAmount)
            .sub((await vault.vaultState()).lastLockedAmount)
            .sub(pendingAmount)
            .mul(await vault.performanceFee())
            .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
        );

        assert.bnEqual(
          secondStartBalance.sub(await vault.totalBalance()).sub(1), // off by 1
          vaultFees
        );

        assert.bnLt(
          (await vault.vaultState()).lockedAmount,
          depositAmount.add(auctionDetails[2]).sub(vaultFees).toString()
        );
        assert.bnGt(
          (await vault.vaultState()).lockedAmount,
          depositAmount
            .add(auctionDetails[2])
            .sub(vaultFees)
            .mul(99)
            .div(100)
            .sub(queuedWithdrawAmount)
            .toString()
        );
      });

      it("is not able to roll to new option consecutively without setNextOption", async function () {
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).rollToNextOption();

        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!nextOption");
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const tx = await vault.connect(keeperSigner).rollToNextOption();
        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 1174745);
        //console.log("rollToNextOption", receipt.gasUsed.toNumber());
      });
    });

    describe("#assetBalance", () => {
      time.revertToSnapshotAfterEach(async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await depositIntoVault(
          params.depositAsset,
          vault,
          params.depositAmount
        );

        await rollToNextOption();
      });

      it("returns the free balance - locked, if free > locked", async function () {
        const newDepositAmount = BigNumber.from("1000000000000");

        await assetContract
          .connect(userSigner)
          .approve(vault.address, newDepositAmount);

        await depositIntoVault(params.depositAsset, vault, newDepositAmount);

        assert.bnEqual(
          await provider.getBalance(vault.address),
          newDepositAmount
        );
      });
    });

    describe("#maxRedeem", () => {
      let oracle: Contract;

      time.revertToSnapshotAfterEach(async function () {
        oracle = await setupOracle(params.underlyingPricer, ownerSigner, true);
      });

      it("is able to redeem deposit at new price per share", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        const tx = await vault.maxRedeem();

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );
        assert.bnEqual(await vault.balanceOf(user), depositAmount);
        assert.bnEqual(await vault.balanceOf(vault.address), BigNumber.from(0));

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, depositAmount, 1);

        const { round, amount, unredeemedShares } = await vault.depositReceipts(
          user
        );

        assert.equal(round, 1);
        assert.bnEqual(amount, BigNumber.from(0));
        assert.bnEqual(unredeemedShares, BigNumber.from(0));
      });

      it("changes balance only once when redeeming twice", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await vault.maxRedeem();

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );
        assert.bnEqual(await vault.balanceOf(user), params.depositAmount);
        assert.bnEqual(await vault.balanceOf(vault.address), BigNumber.from(0));

        const { round, amount, unredeemedShares } = await vault.depositReceipts(
          user
        );

        assert.equal(round, 1);
        assert.bnEqual(amount, BigNumber.from(0));
        assert.bnEqual(unredeemedShares, BigNumber.from(0));

        let res = await vault.maxRedeem();

        await expect(res).to.not.emit(vault, "Transfer");

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );
        assert.bnEqual(await vault.balanceOf(user), params.depositAmount);
        assert.bnEqual(await vault.balanceOf(vault.address), BigNumber.from(0));
      });

      it("redeems after a deposit what was unredeemed from previous rounds", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount.mul(2));

        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await vault.depositETH({ value: depositAmount });

        const tx = await vault.maxRedeem();

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, depositAmount, 2);
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
        await vault.connect(ownerSigner).depositETH({ value: depositAmount });

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).rollToNextOption();

        // Mid-week deposit in round 2
        await vault.connect(userSigner).depositETH({ value: depositAmount });

        const vaultState = await vault.vaultState();

        const beforeBalance = (
          await assetContract.balanceOf(vault.address)
        ).add(vaultState.lockedAmount);

        const beforePps = await vault.pricePerShare();

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(100000000000)
          : firstOptionStrike.add(100000000000);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPriceYearn(
          params.asset,
          oracle,
          settlementPriceITM,
          collateralPricerSigner,
          await getCurrentOptionExpiry()
        );

        await strikeSelection.setDelta(params.deltaSecondOption);

        await vault.connect(ownerSigner).commitAndClose();
        const afterBalance = await assetContract.balanceOf(vault.address);
        const afterPps = await vault.pricePerShare();
        const expectedMintAmountAfterLoss = params.depositAmount
          .mul(BigNumber.from(10).pow(params.tokenDecimals))
          .div(afterPps);

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).rollToNextOption();

        assert.bnGt(beforeBalance, afterBalance);
        assert.bnGt(beforePps, afterPps);

        // owner should lose money
        // User should not lose money
        // owner redeems the deposit from round 1 so there is a loss from ITM options
        const tx1 = await vault.connect(ownerSigner).maxRedeem();
        await expect(tx1)
          .to.emit(vault, "Redeem")
          .withArgs(owner, depositAmount, 1);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(owner);
        assert.equal(round1, 1);
        assert.bnEqual(amount1, BigNumber.from(0));
        assert.bnEqual(unredeemedShares1, BigNumber.from(0));
        assert.bnEqual(await vault.balanceOf(owner), depositAmount);

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
      time.revertToSnapshotAfterEach();

      it("reverts when 0 passed", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });
        await rollToNextOption();
        await expect(vault.redeem(0)).to.be.revertedWith("!numShares");
      });

      it("reverts when redeeming more than available", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await expect(vault.redeem(depositAmount.add(1))).to.be.revertedWith(
          "Exceeds available"
        );
      });

      it("decreases unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

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
      let minETHOut: BigNumberish;

      time.revertToSnapshotAfterEach(async function () {
        const crv = await getContractAt("ICRV", STETH_ETH_CRV_POOL);
        minETHOut = (await crv.get_dy(1, 0, depositAmount))
          .mul(BigNumber.from(100).sub(crvSlippage))
          .div(100);
      });

      it("reverts with 0 amount", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

        await expect(vault.withdrawInstantly(0, 0)).to.be.revertedWith(
          "!amount"
        );
      });

      it("reverts when withdrawing more than available", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

        await expect(
          vault.withdrawInstantly(depositAmount.add(1), 0)
        ).to.be.revertedWith("Exceed amount");
      });

      it("reverts when deposit receipt is processed", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await vault.maxRedeem();

        await expect(
          vault.withdrawInstantly(depositAmount.add(1), 0)
        ).to.be.revertedWith("Invalid round");
      });

      it("reverts when withdrawing next round", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await expect(
          vault.withdrawInstantly(depositAmount.add(1), 0)
        ).to.be.revertedWith("Invalid round");
      });

      it("withdraws the amount in deposit receipt", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

        let startBalance: BigNumber;
        let withdrawAmount: BigNumber;
        if (depositAsset === WETH_ADDRESS[chainId]) {
          startBalance = await provider.getBalance(user);
        } else {
          startBalance = await assetContract.balanceOf(user);
        }

        const tx = await vault.withdrawInstantly(depositAmount, minETHOut, {
          gasPrice,
        });
        const receipt = await tx.wait();

        if (depositAsset === WETH_ADDRESS[chainId]) {
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

      it("is able to withdraw the deposited stETH instantly", async () => {
        const steth = await ethers.getContractAt(
          "ISTETH",
          intermediaryAsset,
          userSigner
        );

        await steth.submit(user, { value: depositAmount });

        await steth.approve(vault.address, depositAmount);

        await vault.depositYieldToken(depositAmount);

        await vault.withdrawInstantly(
          depositAmount.sub(1),
          depositAmount.mul(BigNumber.from(100).sub(crvSlippage)).div(100)
        );
      });
    });

    describe("#initiateWithdraw", () => {
      let oracle: Contract;

      time.revertToSnapshotAfterEach(async () => {
        oracle = await setupOracle(params.underlyingPricer, ownerSigner, true);
      });

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
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await expect(
          vault.initiateWithdraw(depositAmount.add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when withdrawing more than vault + account balance", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await vault.initiateWithdraw(depositAmount.div(2));

        await setOpynOracleExpiryPriceYearn(
          params.asset,
          oracle,
          firstOptionStrike,
          collateralPricerSigner,
          await getCurrentOptionExpiry()
        );
        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).rollToNextOption();

        await expect(
          vault.initiateWithdraw(depositAmount.div(2))
        ).to.be.revertedWith("Existing withdraw");
      });

      it("creates withdrawal from unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        await vault.depositETH({ value: depositAmount });

        const tx = await vault.initiateWithdraw(depositAmount);

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, depositAmount, 2);
      });

      it("reverts when there is insufficient balance over multiple calls", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        const tx = await vault.initiateWithdraw(depositAmount);
        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 126211);
        // console.log("initiateWithdraw", receipt.gasUsed.toNumber());
      });
    });

    describe("#completeWithdraw", () => {
      let minETHOut: BigNumberish;

      time.revertToSnapshotAfterEach(async () => {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await depositIntoVault(
          params.depositAsset,
          vault,
          params.depositAmount
        );

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).depositETH({ value: depositAmount });

        await rollToNextOption();

        await vault.initiateWithdraw(depositAmount);

        const crv = await getContractAt("ICRV", STETH_ETH_CRV_POOL);

        minETHOut = (await crv.get_dy(1, 0, depositAmount))
          .mul(BigNumber.from(100).sub(crvSlippage))
          .div(100);
      });

      it("reverts when not initiated", async function () {
        await expect(
          vault.connect(ownerSigner).completeWithdraw(0)
        ).to.be.revertedWith("Not initiated");
      });

      it("reverts when round not closed", async function () {
        await expect(vault.completeWithdraw(0)).to.be.revertedWith(
          "Round not closed"
        );
      });

      it("reverts when calling completeWithdraw twice", async function () {
        await rollToSecondOption(firstOptionStrike);

        await vault.completeWithdraw(minETHOut);

        await expect(vault.completeWithdraw(0)).to.be.revertedWith(
          "Not initiated"
        );
      });

      it("completes the withdrawal", async function () {
        const firstStrikePrice = firstOptionStrike;
        const settlePriceITM = isPut
          ? firstStrikePrice.sub(100000000)
          : firstStrikePrice.add(100000000);

        await rollToSecondOption(settlePriceITM);

        const lastQueuedWithdrawAmount = await vault.lastQueuedWithdrawAmount();

        let beforeBalance: BigNumber;
        if (depositAsset === WETH_ADDRESS[chainId]) {
          beforeBalance = await provider.getBalance(user);
        } else {
          beforeBalance = await assetContract.balanceOf(user);
        }

        const { queuedWithdrawShares: startQueuedShares } =
          await vault.vaultState();

        const tx = await vault.completeWithdraw(minETHOut, { gasPrice });
        const receipt = await tx.wait();
        const gasFee = receipt.gasUsed.mul(gasPrice);

        await expect(tx)
          .to.emit(vault, "Withdraw")
          .withArgs(user, crvETHAmountAfterSlippage.toString(), depositAmount);

        if (depositAsset !== WETH_ADDRESS[chainId]) {
          const collateralERC20 = await getContractAt("IERC20", depositAsset);

          await expect(tx)
            .to.emit(collateralERC20, "Transfer")
            .withArgs(vault.address, user, crvETHAmountAfterSlippage);
        }

        const { shares, round } = await vault.withdrawals(user);
        assert.equal(shares, 0);
        assert.equal(round, 2);

        const { queuedWithdrawShares: endQueuedShares } =
          await vault.vaultState();

        assert.bnEqual(endQueuedShares, BigNumber.from(0));
        assert.bnEqual(
          await vault.lastQueuedWithdrawAmount(),
          lastQueuedWithdrawAmount.sub(crvETHAmountAfterSlippage)
        );
        assert.bnEqual(startQueuedShares.sub(endQueuedShares), depositAmount);

        let actualWithdrawAmount: BigNumber;

        if (depositAsset === WETH_ADDRESS[chainId]) {
          const afterBalance = await provider.getBalance(user);
          actualWithdrawAmount = afterBalance.sub(beforeBalance).add(gasFee);
        } else {
          const afterBalance = await assetContract.balanceOf(user);
          actualWithdrawAmount = afterBalance.sub(beforeBalance);
        }

        // Should be less because the pps is down
        assert.bnLt(actualWithdrawAmount, depositAmount);
        assert.bnEqual(actualWithdrawAmount, crvETHAmountAfterSlippage);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await rollToSecondOption(firstOption.strikePrice);

        const tx = await vault.completeWithdraw(minETHOut, { gasPrice });
        const receipt = await tx.wait();

        assert.isAtMost(receipt.gasUsed.toNumber(), 277018);
        // console.log(
        //   params.name,
        //   "completeWithdraw",
        //   receipt.gasUsed.toNumber()
        // );
      });
    });

    describe("#setStrikePrice", () => {
      time.revertToSnapshotAfterEach();

      it("should revert if not owner", async function () {
        await expect(
          vault.connect(userSigner).setStrikePrice(parseEther("10"))
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("should set the new strike price", async function () {
        await vault.connect(ownerSigner).setStrikePrice(parseEther("10"));
        assert.bnEqual(
          BigNumber.from(await vault.overriddenStrikePrice()),
          parseEther("10")
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
        const tx = await vault.connect(ownerSigner).setCap(parseEther("10"));
        assert.equal((await vault.cap()).toString(), parseEther("10"));
        await expect(tx)
          .to.emit(vault, "CapSet")
          .withArgs(parseEther("500"), parseEther("10"));
      });

      it("should revert when depositing over the cap", async function () {
        const capAmount = BigNumber.from("100000000");
        const depositAmount = BigNumber.from("10000000000");
        await vault.connect(ownerSigner).setCap(capAmount);

        await expect(
          vault.depositETH({ value: depositAmount })
        ).to.be.revertedWith("Exceed cap");
      });
    });

    describe("#sendLDORewards", () => {
      time.revertToSnapshotAfterEach();

      it("should send LDO rewards to feeRecipient", async function () {
        const LDO_HOLDER = "0xba4a6c7f357dff95c89f465ca15943d56fc2720e";
        await hre.network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [LDO_HOLDER],
        });
        const ldoHolder = await ethers.provider.getSigner(LDO_HOLDER);

        const ldo = await ethers.getContractAt("IERC20", LDO_ADDRESS);

        let ldoDepositAmount = BigNumber.from(100);

        await ldo.connect(ldoHolder).transfer(vault.address, ldoDepositAmount);

        let startBalance = await ldo.balanceOf(vault.address);

        await vault.sendLDORewards();

        let endBalance = await ldo.balanceOf(vault.address);

        assert.equal(
          startBalance.sub(endBalance).toString(),
          ldoDepositAmount.toString()
        );
        assert.equal(
          (await ldo.balanceOf(feeRecipient)).toString(),
          ldoDepositAmount.toString()
        );
      });
    });

    describe("#shares", () => {
      time.revertToSnapshotAfterEach();

      it("shows correct share balance after redemptions", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

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
        await vault.depositETH({ value: depositAmount });

        await rollToNextOption();

        assert.bnEqual(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).depositETH({ value: depositAmount });

        // remain the same after deposit
        assert.bnEqual(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(100000000000)
          : firstOptionStrike.add(100000000000);

        //console.log(settlementPriceITM.toString());

        await rollToSecondOption(settlementPriceITM);

        assert.bnLt(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );
      });
    });

    describe("#totalBalance", () => {
      beforeEach(async function () {
        const addressToDeposit = [userSigner, ownerSigner, adminSigner];

        await setupYieldToken(
          addressToDeposit,
          intermediaryAsset,
          vault,
          params.depositAsset == WETH_ADDRESS[chainId]
            ? parseEther("7")
            : depositAmount.mul(3)
        );
      });

      it("should return correct balance", async () => {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);

        await vault.depositETH({ value: depositAmount });

        assert.bnEqual(await vault.totalBalance(), depositAmount);

        await vault.depositYieldToken(depositAmount);

        assert.bnEqual(await vault.totalBalance(), depositAmount.mul(2).sub(1));
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
        asset === WETH_ADDRESS[chainId] ? ethusdcPool : wbtcusdcPool
      );
    }
  };
}

async function depositIntoVault(
  asset: string,
  vault: Contract,
  amount: BigNumberish
) {
  if (asset === WETH_ADDRESS[chainId]) {
    await vault.depositETH({ value: amount });
  } else {
    await vault.deposit(amount);
  }
}

async function setupYieldToken(
  addressToDeposit: SignerWithAddress[],
  intermediaryAsset: string,
  vault: Contract,
  amount: BigNumberish
) {
  const STETH_HOLDER = "0x17b0a8091e0dc5288bb9d9efaa58086dc81764d5";
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [STETH_HOLDER],
  });
  const stethHolder = await ethers.provider.getSigner(STETH_HOLDER);
  const steth = await ethers.getContractAt("IERC20", intermediaryAsset);

  for (let i = 0; i < addressToDeposit.length; i++) {
    await steth
      .connect(stethHolder)
      .transfer(addressToDeposit[i].address, amount);
    await steth.connect(addressToDeposit[i]).approve(vault.address, amount);
  }
}
