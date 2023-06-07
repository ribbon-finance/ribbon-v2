/* eslint-disable no-unused-vars */
import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import ManualVolOracle_ABI from "../constants/abis/ManualVolOracle.json";
import OptionsPremiumPricerInStables_ABI from "../constants/abis/OptionsPremiumPricerInStables.json";
import moment from "moment-timezone";
import * as time from "./helpers/time";
import {
  OPTION_PROTOCOL,
  CHAINID,
  ETH_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  GAMMA_CONTROLLER,
  CHAINLINK_WETH_PRICER,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  USDC_OWNER_ADDRESS,
  WETH_ADDRESS,
  OptionsPremiumPricerInStables_BYTECODE,
  ManualVolOracle_BYTECODE,
  NULL_ADDR,
  ORACLE_DISPUTE_PERIOD,
} from "../constants/constants";
import {
  setupOracle,
  setOpynOracleExpiryPrice,
  whitelistProduct,
  mintToken,
  getBlockNum,
  deployProxyAutocall,
} from "./helpers/utils";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "./helpers/assertions";
import { TEST_URI } from "../scripts/helpers/getDefaultEthersProvider";
import { ETH_STRIKE_MULTIPLIER, STRIKE_STEP } from "../scripts/utils/constants";
const { provider, getContractAt, getContractFactory } = ethers;
const { parseEther } = ethers.utils;

moment.tz.setDefault("UTC");

//const OPTION_DELAY = 0;
const DELAY_INCREMENT = 100;
//const gasPrice = parseUnits("1", "gwei");
const FEE_SCALING = BigNumber.from(10).pow(6);
const WEEKS_PER_YEAR = 52142857;

const chainId = network.config.chainId;

describe("RibbonAutocallVault", () => {
  behavesLikeRibbonOptionsVault({
    name: `Ribbon ETH Treasury Vault (Put)`,
    tokenName: "Ribbon ETH Treasury Vault Put",
    tokenSymbol: "rETH-TSRY-P",
    asset: WETH_ADDRESS[chainId],
    assetContractName: "IWBTC",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: USDC_ADDRESS[chainId],
    chainlinkPricer: CHAINLINK_WETH_PRICER[chainId],
    deltaStep: BigNumber.from(STRIKE_STEP.ETH),
    depositAmount: BigNumber.from("100000000000"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("12500000000"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("0"),
    performanceFee: BigNumber.from("0"),
    manualStrikePrice: BigNumber.from("1000").mul(
      BigNumber.from("10").pow("8")
    ),
    auctionDuration: 21600,
    tokenDecimals: 6,
    isPut: true,
    gasLimits: {
      depositWorstCase: 161000,
      depositBestCase: 95000,
    },
    mintConfig: {
      contractOwnerAddress: USDC_OWNER_ADDRESS[chainId],
    },
    period: 30,
    oracle: ETH_PRICE_ORACLE[chainId],
    premiumInStables: true,
    multiplier: ETH_STRIKE_MULTIPLIER,
    maxDepositors: 30,
    minDeposit: parseUnits("1", 18),
    availableChains: [CHAINID.ETH_MAINNET],
  });
});

type Option = {
  address: string;
  strikePrice: BigNumber;
  expiry: number;
};

type CouponState = {
  couponType: string;
  nCouponType: string;
  AB: number;
  nAB: number;
  CB: number;
  nCB: number;
};

type PutOption = {
  optionType: string;
  nOptionType: string;
  payoff: BigNumber;
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
 * @param {boolean} params.isPut - Boolean flag for if the vault sells call or put options
 * @param {number[]} params.availableChains - ChainIds where the tests for the vault will be executed
 * @param {number} params.maxDepositors: - Max. depositors allowed
 * @param {BigNumber} params.minDeposit: - Minimum deposit per depositor
 * @param {number} params.premiumInStables: - Boolean flag whether premium is denominated in stables
 * @param {number} params.oracle: - Oracle pricer for the underlying asset
 * @param {number} params.period: - Period between each options sale
 * @param {number} params.multiplier: - Multiplier to decide for strike price
 * @param {BigNumber} params.manualStrikePrice: - Overriden strike price
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
  deltaStep: BigNumber;
  depositAmount: BigNumber;
  minimumSupply: string;
  expectedMintAmount: BigNumber;
  auctionDuration: number;
  premiumDiscount: BigNumber;
  managementFee: BigNumber;
  performanceFee: BigNumber;
  isPut: boolean;
  gasLimits: {
    depositWorstCase: number;
    depositBestCase: number;
  };
  mintConfig?: {
    contractOwnerAddress: string;
  };
  manualStrikePrice: BigNumber;
  period: number;
  oracle: string;
  premiumInStables: Boolean;
  multiplier: number;
  maxDepositors: number;
  minDeposit: BigNumber;
  availableChains: number[];
}) {
  // Test configs
  let availableChains = params.availableChains;

  // Skip test when vault is not available in the current chain
  if (!availableChains.includes(chainId)) {
    return;
  }

  // Addresses
  let owner: string,
    keeper: string,
    user: string,
    feeRecipient: string,
    autocallSeller: string;

  // Signers
  let adminSigner: SignerWithAddress,
    userSigner: SignerWithAddress,
    ownerSigner: SignerWithAddress,
    keeperSigner: SignerWithAddress,
    feeRecipientSigner: SignerWithAddress,
    autocallSellerSigner: SignerWithAddress,
    pricerSigner: SignerWithAddress;

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
  // let expectedMintAmount = params.expectedMintAmount;
  let auctionDuration = params.auctionDuration;
  let isPut = params.isPut;
  let period = params.period;
  let oraclePricer = params.oracle;
  let premiumAsset = USDC_ADDRESS[chainId];
  let premiumInStables = params.premiumInStables;
  let maxDepositors = params.maxDepositors;
  let minDeposit = params.minDeposit;
  let manualStrikePrice = params.manualStrikePrice;

  // Contracts
  let strikeSelection: Contract;
  let volOracle: Contract;
  let optionsPremiumPricer: Contract;
  let vaultLifecycleTreasuryLib: Contract;
  let vault: Contract;
  let oTokenFactory: Contract;
  let defaultOtoken: Contract;
  let assetContract: Contract;
  let premiumContract: Contract;
  let oracle: Contract;

  // Variables
  let defaultOtokenAddress: string;
  let firstOptionStrike: BigNumber;
  let firstOptionExpiry: number;
  let optionId: string;
  let PCT_MULTIPLIER = 10000;
  let OTOKEN_DECIMALS = 8;

  describe(`${params.name}`, () => {
    let initSnapshotId: string;
    let firstOption: Option;

    const rollToNextOption = async () => {
      await vault.connect(ownerSigner).commitAndClose();
      await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT);
      await vault.connect(keeperSigner).rollToNextOption();
    };

    const rollToSecondOption = async (settlementPrice: BigNumber) => {
      const oracle = await setupOracle(
        params.asset,
        params.chainlinkPricer,
        ownerSigner,
        OPTION_PROTOCOL.GAMMA
      );

      await setOpynOracleExpiryPrice(
        params.asset,
        oracle,
        await getCurrentOptionExpiry(),
        settlementPrice
      );
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
              jsonRpcUrl: TEST_URI[chainId],
              blockNumber: await getBlockNum(asset, chainId),
            },
          },
        ],
      });

      initSnapshotId = await time.takeSnapshot();

      [
        adminSigner,
        ownerSigner,
        keeperSigner,
        userSigner,
        feeRecipientSigner,
        autocallSellerSigner,
      ] = await ethers.getSigners();
      owner = ownerSigner.address;
      keeper = keeperSigner.address;
      user = userSigner.address;
      feeRecipient = feeRecipientSigner.address;
      autocallSeller = autocallSellerSigner.address;

      const TestVolOracle = await getContractFactory(
        ManualVolOracle_ABI,
        ManualVolOracle_BYTECODE,
        keeperSigner
      );

      volOracle = await TestVolOracle.deploy(keeper);

      optionId = await volOracle.getOptionId(
        params.deltaStep,
        asset,
        collateralAsset,
        isPut
      );

      await volOracle.setAnnualizedVol([optionId], [165273561]);

      const topOfPeriod = (await time.getTopOfPeriod()) + time.PERIOD;
      await time.increaseTo(topOfPeriod);

      const OptionsPremiumPricer = await getContractFactory(
        OptionsPremiumPricerInStables_ABI,
        OptionsPremiumPricerInStables_BYTECODE,
        ownerSigner
      );

      const StrikeSelection = await getContractFactory(
        "PercentStrikeSelection",
        ownerSigner
      );

      optionsPremiumPricer = await OptionsPremiumPricer.deploy(
        optionId,
        volOracle.address,
        params.asset === WETH_ADDRESS[chainId]
          ? ETH_PRICE_ORACLE[chainId]
          : oraclePricer,
        USDC_PRICE_ORACLE[chainId]
      );

      strikeSelection = await StrikeSelection.deploy(
        optionsPremiumPricer.address,
        params.multiplier,
        params.deltaStep
      );

      const VaultLifecycleTreasury = await ethers.getContractFactory(
        "VaultLifecycleTreasury"
      );
      vaultLifecycleTreasuryLib = await VaultLifecycleTreasury.deploy();

      const initializeOptionType = 0; // VANILLA
      const initializeCouponType = 3; // VANILLA
      const initializeAB = 10500;
      const initializeNAB = 0;
      const initializenCB = 10500;
      const initializenNCB = 0;

      const obsFreq = 518400; // 6 days

      const initializeArgs = [
        [
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
          period,
          maxDepositors,
          minDeposit,
        ],
        [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ],
        initializeOptionType,
        [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ],
        obsFreq,
        autocallSeller,
      ];

      const deployArgs = [
        USDC_ADDRESS[chainId],
        OTOKEN_FACTORY[chainId],
        GAMMA_CONTROLLER[chainId],
        MARGIN_POOL[chainId],
      ];

      vault = (
        await deployProxyAutocall(
          "RibbonAutocallVault",
          adminSigner,
          initializeArgs,
          deployArgs,
          {
            libraries: {
              VaultLifecycleTreasury: vaultLifecycleTreasuryLib.address,
            },
          }
        )
      ).connect(userSigner);

      oTokenFactory = await getContractAt(
        "IOtokenFactory",
        OTOKEN_FACTORY[chainId]
      );

      await whitelistProduct(
        params.asset,
        params.strikeAsset,
        params.collateralAsset,
        params.isPut,
        OPTION_PROTOCOL.GAMMA
      );

      const latestTimestamp = (await provider.getBlock("latest")).timestamp;

      // Create first option
      firstOptionExpiry = moment(latestTimestamp * 1000)
        .add(period, "days")
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

      defaultOtokenAddress = firstOption.address;
      defaultOtoken = await getContractAt("IERC20", defaultOtokenAddress);
      assetContract = await getContractAt(
        params.assetContractName,
        collateralAsset
      );

      if (premiumAsset === WETH_ADDRESS[chainId]) {
        premiumContract = await getContractAt("IWETH", premiumAsset);
      } else {
        premiumContract = await getContractAt("IERC20", premiumAsset);
      }

      // If mintable token, then mine the token
      if (params.mintConfig) {
        const addressToDeposit = [
          userSigner,
          ownerSigner,
          adminSigner,
          autocallSellerSigner,
        ];

        let toMint = parseEther("200");

        if (params.collateralAsset === USDC_ADDRESS[chainId]) {
          toMint = BigNumber.from("10000000000000");
        }

        for (let i = 0; i < addressToDeposit.length; i++) {
          await mintToken(
            assetContract,
            params.mintConfig.contractOwnerAddress,
            addressToDeposit[i].address,
            vault.address,
            toMint
          );
          if (premiumInStables) {
            if (premiumAsset === WETH_ADDRESS[chainId]) {
              await premiumContract
                .connect(userSigner)
                .deposit({ value: parseEther("100") });
            } else {
              await mintToken(
                premiumContract,
                USDC_OWNER_ADDRESS[chainId],
                addressToDeposit[i].address,
                vault.address,
                BigNumber.from("10000000000000")
              );
            }
          }
        }
      } else if (params.asset === WETH_ADDRESS[chainId]) {
        await assetContract
          .connect(userSigner)
          .deposit({ value: parseEther("100") });
      }

      // setup oracle
      oracle = await setupOracle(
        params.asset,
        params.chainlinkPricer,
        ownerSigner,
        OPTION_PROTOCOL.GAMMA
      );
      const pricer = await oracle.getPricer(params.asset);
      await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [pricer],
      });
      pricerSigner = await ethers.getSigner(pricer);
    });

    after(async () => {
      await time.revertToSnapShot(initSnapshotId);
    });

    describe("#initialize", () => {
      let testVault: Contract;

      const initializeOptionType = 0; // VANILLA
      const initializeCouponType = 3; // VANILLA
      const initializeAB = 10500;
      const initializeNAB = 10500;
      const initializenCB = 10500;
      const initializenNCB = 10500;

      const obsFreq = 6;

      time.revertToSnapshotAfterEach(async function () {
        const RibbonAutocallVault = await ethers.getContractFactory(
          "RibbonAutocallVault",
          {
            libraries: {
              VaultLifecycleTreasury: vaultLifecycleTreasuryLib.address,
            },
          }
        );
        testVault = await RibbonAutocallVault.deploy(
          USDC_ADDRESS[chainId],
          OTOKEN_FACTORY[chainId],
          GAMMA_CONTROLLER[chainId],
          MARGIN_POOL[chainId]
        );
      });

      it("initializes with correct values", async function () {
        assert.equal((await vault.cap()).toString(), parseEther("2000000"));
        assert.equal(await vault.owner(), owner);
        assert.equal(await vault.keeper(), keeper);
        assert.equal(await vault.feeRecipient(), feeRecipient);
        assert.equal(
          (await vault.managementFee()).toString(),
          managementFee
            .mul(FEE_SCALING)
            .div(
              period % 30 === 0
                ? FEE_SCALING.mul(12 / (period / 30))
                : BigNumber.from(WEEKS_PER_YEAR).div(period / 7)
            )
            .toString()
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
        assert.equal(await vault.USDC(), USDC_ADDRESS[chainId]);
        assert.bnEqual(await vault.totalPending(), BigNumber.from(0));
        assert.equal(minimumSupply, params.minimumSupply);
        assert.equal(isPut, params.isPut);
        assert.equal(
          (await vault.premiumDiscount()).toString(),
          params.premiumDiscount.toString()
        );
        assert.bnEqual(cap, parseEther("2000000"));
        assert.equal(
          await vault.optionsPremiumPricer(),
          optionsPremiumPricer.address
        );
        assert.equal(await vault.strikeSelection(), strikeSelection.address);
        assert.equal((await vault.putOption())[1], 0);
        assert.equal((await vault.couponState())[1], 3);
        assert.equal((await vault.couponState())[3], 10500);
        assert.equal((await vault.couponState())[5], 10500);
        assert.equal(await vault.autocallSeller(), autocallSeller);
        assert.equal(await vault.numTotalObs(), 5);
      });

      it("cannot be initialized twice", async function () {
        const initializeArgs1 = [
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
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          vault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            obsFreq,
            autocallSeller
          )
        ).to.be.revertedWith("Initializable: contract is already initialized");
      });

      it("reverts when initializing with 0 owner", async function () {
        const initializeArgs1 = [
          NULL_ADDR,
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
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            obsFreq,
            autocallSeller
          )
        ).to.be.revertedWith("!_owner");
      });

      it("reverts when initializing with 0 keeper", async function () {
        const initializeArgs1 = [
          owner,
          NULL_ADDR,
          feeRecipient,
          managementFee,
          performanceFee,
          tokenName,
          tokenSymbol,
          optionsPremiumPricer.address,
          strikeSelection.address,
          premiumDiscount,
          auctionDuration,
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            obsFreq,
            autocallSeller
          )
        ).to.be.revertedWith("!_keeper");
      });

      it("reverts when initializing with 0 feeRecipient", async function () {
        const initializeArgs1 = [
          owner,
          keeper,
          NULL_ADDR,
          managementFee,
          performanceFee,
          tokenName,
          tokenSymbol,
          optionsPremiumPricer.address,
          strikeSelection.address,
          premiumDiscount,
          auctionDuration,
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            obsFreq,
            autocallSeller
          )
        ).to.be.revertedWith("!_feeRecipient");
      });

      it("reverts when initializing with 0 initCap", async function () {
        const initializeArgs1 = [
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
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          0,
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            obsFreq,
            autocallSeller
          )
        ).to.be.revertedWith("!cap");
      });

      it("reverts when asset is 0x", async function () {
        const initializeArgs1 = [
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
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          NULL_ADDR,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            obsFreq,
            autocallSeller
          )
        ).to.be.revertedWith("!asset");
      });

      it("reverts when autocallSeller is 0", async function () {
        const initializeArgs1 = [
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
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            obsFreq,
            NULL_ADDR
          )
        ).to.be.revertedWith("A7");
      });

      it("reverts when observation frequency is 0 or not a multiple of period", async function () {
        const initializeArgs1 = [
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
          period,
          maxDepositors,
          minDeposit,
        ];

        const initializeArgs2 = [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseEther("2000000"),
        ];

        const initializeArgs3 = [
          initializeCouponType,
          initializeCouponType,
          initializeAB,
          initializeNAB,
          initializenCB,
          initializenNCB,
        ];

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            0,
            autocallSeller
          )
        ).to.be.revertedWith("A8");

        await expect(
          testVault[
            "initialize((address,address,address,uint256,uint256,string,string,address,address,uint32,uint256,uint256,uint256,uint256),(bool,uint8,address,address,uint56,uint104),uint8,(uint8,uint8,uint256,uint256,uint256,uint256),uint256,address)"
          ](
            initializeArgs1,
            initializeArgs2,
            initializeOptionType,
            initializeArgs3,
            345600,
            autocallSeller
          )
        ).to.be.revertedWith("A8");
      });
    });

    // eslint-disable-next-line multiline-comment-style
    describe("#lastObservation", () => {
      time.revertToSnapshotAfterTest();
      let expiry;
      let numTotalObs;
      let obsFreq;

      before(async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);
        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        expiry = await currentOtoken.expiryTimestamp();
        numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
      });

      it("between start and observation 1 - sucessfully returns last observation index and timestamp", async function () {
        const [index, ts] = await vault.lastObservation();

        const timestamp = expiry - (numTotalObs - index) * obsFreq;

        assert.equal(index, 0);
        assert.equal(ts.toString(), timestamp.toString());
      });
      it("between observation 1 and 2 - sucessfully returns last observation index and timestamp", async function () {
        await time.increase(obsFreq.add(1));

        const [index, ts] = await vault.lastObservation();

        const timestamp = expiry - (numTotalObs - index) * obsFreq;

        assert.equal(index, 1);
        assert.equal(ts.toString(), timestamp.toString());
      });
      it("between observation 2 and 3 - sucessfully returns last observation index and timestamp", async function () {
        await time.increase(obsFreq.add(1));

        const [index, ts] = await vault.lastObservation();

        const timestamp = expiry - (numTotalObs - index) * obsFreq;

        assert.equal(index, 2);
        assert.equal(ts.toString(), timestamp.toString());
      });
      it("between observation 3 and 4 - sucessfully returns last observation index and timestamp", async function () {
        await time.increase(obsFreq.add(1));

        const [index, ts] = await vault.lastObservation();

        const timestamp = expiry - (numTotalObs - index) * obsFreq;

        assert.equal(index, 3);
        assert.equal(ts.toString(), timestamp.toString());
      });
      it("between observation 4 and 5 - sucessfully returns last observation index and timestamp", async function () {
        await time.increase(obsFreq.add(1));

        const [index, ts] = await vault.lastObservation();

        const timestamp = expiry - (numTotalObs - index) * obsFreq;

        assert.equal(index, 4);
        assert.equal(ts.toString(), timestamp.toString());
      });
      it("beyond observation 5/expiry - sucessfully returns last observation index and timestamp", async function () {
        await time.increase(obsFreq.add(1));

        const [index, ts] = await vault.lastObservation();

        const timestamp = expiry - (numTotalObs - index) * obsFreq;

        assert.equal(index, 5);
        assert.equal(ts.toString(), timestamp.toString());
      });
    });

    describe("#setOptionType", () => {
      time.revertToSnapshotAfterEach();

      it("reverts if caller is not owner", async function () {
        await expect(vault.setOptionType(2)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
      it("successfully sets option type", async function () {
        assert.equal((await vault.putOption())[1], 0);

        const tx = await vault.connect(ownerSigner).setOptionType(2);

        assert.equal((await vault.putOption())[1], 2);

        await expect(tx).to.emit(vault, "OptionTypeSet").withArgs(2);
      });
    });

    describe("#setCouponState", () => {
      time.revertToSnapshotAfterEach();

      it("reverts if caller is not owner", async function () {
        await expect(vault.setCouponState(2, 10500, 9500)).to.be.revertedWith(
          "Ownable: caller is not the owner"
        );
      });
      it("reverts if AB is lower than PCT_MULTIPLIER", async function () {
        await expect(
          vault.connect(ownerSigner).setCouponState(0, 9950, 0)
        ).to.be.revertedWith("A1");
      });
      it("reverts if coupon type is FIXED and CB is not zero", async function () {
        await expect(
          vault.connect(ownerSigner).setCouponState(0, 10500, 1)
        ).to.be.revertedWith("A2");
      });
      it("reverts if coupon type is VANILLA and CB is not equal to AB", async function () {
        await expect(
          vault.connect(ownerSigner).setCouponState(3, 10500, 0)
        ).to.be.revertedWith("A3");
      });
      it("reverts if coupon type is PHOENIX/PHOENIX-MEMORY and CB is 0", async function () {
        await expect(
          vault.connect(ownerSigner).setCouponState(2, 10500, 0)
        ).to.be.revertedWith("A4");
      });
      it("reverts if coupon type is PHOENIX/PHOENIX-MEMORY and CB equal or higher to AB", async function () {
        await expect(
          vault.connect(ownerSigner).setCouponState(2, 10500, 10500)
        ).to.be.revertedWith("A5");
      });
      it("successfully sets coupon type", async function () {
        assert.equal((await vault.couponState())[1], 3);
        assert.equal((await vault.couponState())[3], 10500);
        assert.equal((await vault.couponState())[5], 10500);

        const tx = await vault
          .connect(ownerSigner)
          .setCouponState(2, 11000, 9500);

        assert.equal((await vault.couponState())[1], 2);
        assert.equal((await vault.couponState())[3], 11000);
        assert.equal((await vault.couponState())[5], 9500);

        await expect(tx)
          .to.emit(vault, "CouponStateSet")
          .withArgs(2, 11000, 9500);
      });
    });

    describe("#setPeriodAndObservationFrequency", () => {
      time.revertToSnapshotAfterEach();

      it("reverts if caller is not owner", async function () {
        await expect(
          vault.setPeriodAndObservationFrequency(60, 100000)
        ).to.be.revertedWith("Ownable: caller is not the owner");
      });
      it("reverts if period is zero", async function () {
        await expect(
          vault.connect(ownerSigner).setPeriodAndObservationFrequency(0, 100000)
        ).to.be.revertedWith("A9");
      });
      it("reverts when observation sequence is 0 or not a multiple of period", async function () {
        await expect(
          vault.connect(ownerSigner).setPeriodAndObservationFrequency(60, 0)
        ).to.be.revertedWith("A8");

        await expect(
          vault.connect(ownerSigner).setPeriodAndObservationFrequency(60, 7)
        ).to.be.revertedWith("A8");
      });
      it("successfully sets period and observation frequency type", async function () {
        const tx = await vault
          .connect(ownerSigner)
          .setPeriodAndObservationFrequency(60, 86400); // 60 days - daily observation

        await expect(tx)
          .to.emit(vault, "PeriodAndObsFreqSet")
          .withArgs(0, 86400, 30, 60);
      });
    });

    describe("#couponsEarned", () => {
      time.revertToSnapshotAfterTest();
      let initialSpotPrice;
      let AB;
      let numTotalObs;
      let obsFreq;
      let premiumAmount;
      let currentOtoken;
      let snapshot0;
      let snapshot1;
      let snapshot2;

      before(async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);
        await rollToNextOption();

        currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const expiry = await currentOtoken.expiryTimestamp();
        numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days

        initialSpotPrice = await vault.initialSpotPrice();
        AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        const [nCouponsEarned, earnedAmt, autocallTS] =
          await vault.couponsEarned();

        assert.equal(nCouponsEarned, 0);
        assert.equal(earnedAmt, 0);
        assert.equal(autocallTS.toString(), expiry.toString());

        premiumAmount = BigNumber.from("1000000000"); // 1000 USDC
        await approve(
          premiumContract,
          vault,
          premiumAmount,
          autocallSellerSigner
        );
      });
      it("reverts if expiry was not set for a given observation timestamp", async function () {
        snapshot0 = await time.takeSnapshot();

        const expiry = await currentOtoken.expiryTimestamp();
        const obs1 = expiry - numTotalObs.sub(BigNumber.from("1")) * obsFreq;

        await time.increase(obsFreq.add(1));
        await oracle
          .connect(pricerSigner)
          .setExpiryPrice(params.asset, obs1, AB.sub(1));

        await time.increase(obsFreq.add(1));

        await expect(vault.couponsEarned()).to.be.revertedWith("A12");

        await time.revertToSnapShot(snapshot0);
      });
      it("sucessfully returns data for VANILLA coupon type when autocall is never breached", async function () {
        snapshot0 = await time.takeSnapshot();

        // set prices for observation such that autocall barrier is never hit
        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
        ];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        const [nCouponsEarned, earnedAmt, autocallTS] =
          await vault.couponsEarned();

        assert.equal(nCouponsEarned.toString(), 0);
        assert.equal(earnedAmt.toString(), 0);
        assert.equal(autocallTS.toString(), expiry.toString());

        await time.revertToSnapShot(snapshot0);
      });
      it("sucessfully returns data for VANILLA coupon type when autocall is breached", async function () {
        // autocall seller transfers premium
        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        // set prices for observation such that autocall barrier is hit on observation 5 - max payoff

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.add(1),
        ];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        const [nCouponsEarned, earnedAmt, autocallTS] =
          await vault.couponsEarned();

        assert.equal(nCouponsEarned.toString(), 5);
        assert.equal(earnedAmt.toString(), premiumAmount.toString());
        assert.equal(autocallTS.toString(), expiry.toString());

        // Since the initialization test already had VANILLA as the next coupon type
        // we had to do that one first. The remaining 3 coupon types come after that one
        // and we use snapshots to come back to the end of the VANILLA round
        snapshot1 = await time.takeSnapshot();
      });
      it("sucessfully returns data for FIXED coupon type", async function () {
        const AB_PCT = 10500;
        await vault.connect(ownerSigner).setCouponState(0, AB_PCT, 0);

        await time.increase(8640000); // increase time beyond the oracle dispute period
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);
        await rollToNextOption();

        currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        // ensure option type has changed
        assert.equal((await vault.couponState())[1], 0);

        // autocall seller transfers premium
        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        // set prices for observation such that autocall barrier is hit on observation 3

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [AB.sub(1), AB.sub(1), AB.add(1)];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        const [nCouponsEarned, earnedAmt, autocallTS] =
          await vault.couponsEarned();

        assert.equal(nCouponsEarned.toString(), 3);
        assert.equal(
          earnedAmt.toString(),
          premiumAmount.div(5).mul(3).toString()
        );
        assert.equal(autocallTS.toString(), observations[2].toString());
      });
      it("sucessfully returns data for PHOENIX coupon type", async function () {
        await time.revertToSnapShot(snapshot1);
        snapshot2 = await time.takeSnapshot();

        const AB_PCT = 10500;
        const CB_PCT = 9500;
        await vault.connect(ownerSigner).setCouponState(1, AB_PCT, CB_PCT);

        await time.increase(864000000); // increase time beyond the oracle dispute period
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);
        await rollToNextOption();

        const CB = (await vault.couponState())[4]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        // ensure option type has changed
        assert.equal((await vault.couponState())[1], 1);

        // autocall seller transfers premium
        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        // set prices for observation such that
        // coupon barrier is hit on observation 2
        // autocall barrier is hit on observation 4

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [CB.sub(1), CB.add(1), CB.sub(1), AB.add(1)];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        const [nCouponsEarned, earnedAmt, autocallTS] =
          await vault.couponsEarned();

        assert.equal(nCouponsEarned.toString(), 2);
        assert.equal(
          earnedAmt.toString(),
          premiumAmount.div(5).mul(2).toString()
        );
        assert.equal(autocallTS.toString(), observations[3].toString());
      });
      it("sucessfully returns data for PHOENIX_MEMORY coupon type", async function () {
        await time.revertToSnapShot(snapshot2);

        const AB_PCT = 10500;
        const CB_PCT = 9500;
        await vault.connect(ownerSigner).setCouponState(2, AB_PCT, CB_PCT);

        await time.increase(864000000); // increase time beyond the oracle dispute period
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);
        await rollToNextOption();

        const CB = (await vault.couponState())[4]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        // ensure option type has changed
        assert.equal((await vault.couponState())[1], 2);

        // autocall seller transfers premium
        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        // set prices for observation such that
        // coupon barrier is hit on observation 2
        // autocall barrier is hit on observation 4

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [CB.sub(1), CB.add(1), CB.sub(1), AB.add(1)];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        const [nCouponsEarned, earnedAmt, autocallTS] =
          await vault.couponsEarned();

        assert.equal(nCouponsEarned.toString(), 4);
        assert.equal(
          earnedAmt.toString(),
          premiumAmount.div(5).mul(4).toString()
        );
        assert.equal(autocallTS.toString(), observations[3].toString());
      });
    });

    describe("#commitAndClose", () => {
      time.revertToSnapshotAfterEach();
      let obsFreq;

      it("reverts if autocall barrier has not been breached before expiry", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);
        await rollToNextOption();

        await expect(vault.commitAndClose()).to.be.revertedWith("A10");
      });
      it("reverts before expiry if locked amount > 0", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is hit on observation 3

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [AB.sub(1), AB.sub(1), AB.add(1)];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // tokens are sent to autocall seller but only a part is returned
        await vault.connect(ownerSigner).sendOTokens(autocallSeller);
        await currentOtoken
          .connect(autocallSellerSigner)
          .transfer(vault.address, 1);

        await expect(vault.commitAndClose()).to.be.revertedWith("A11");
      });

      it("successfully commit and closes an autocall with VANILLA coupon and VANILLA downside earlier than maturity", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
        const strikePrice = await currentOtoken.strikePrice();

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is hit on observation 3

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [AB.sub(1), AB.sub(1), AB.add(1)];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // reserve ratio / locked amount check
        const reserveRatio = initialSpotPrice
          .sub(strikePrice)
          .mul(10 ** OTOKEN_DECIMALS)
          .div(initialSpotPrice);

        const lockedAmount = (await vault.vaultState())[1];

        assert.equal(
          lockedAmount
            .mul(10 ** OTOKEN_DECIMALS)
            .div(depositAmount)
            .toString(),
          (10 ** OTOKEN_DECIMALS - reserveRatio).toString()
        );

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );

        // Out of 5 coupons 3 went to the user and 2 are returned to the MM/autocall seller
        const returnAmt = premiumAmount.div(numTotalObs).mul(2);
        assert.equal(
          mmUSDCBalAfter.sub(mmUSDCBalBefore).toString(),
          returnAmt.sub(premiumAmount).toString()
        );

        // user transfers the deposit amount
        const earnedAmt = premiumAmount.div(numTotalObs).mul(3);
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit plus the earned amount
        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // since it was an early termination all unexpired oTokens were burned
        assert.bnGt(vaultOtokenBalBefore, 0);
        assert.equal(vaultOtokenBalAfter, 0);

        // user vault account balance increases by the earned amount
        assert.equal(
          (await vault.accountVaultBalance(user)).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 0); // optionType
        assert.equal((await vault.putOption())[1], 0); // nOptionType
        assert.equal((await vault.putOption())[2], 0); // payoff
      });

      it("successfully commit and closes an autocall with VANILLA coupon and DIP downside earlier than maturity", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await vault.connect(ownerSigner).setOptionType(1);
        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
        const strikePrice = await currentOtoken.strikePrice();

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is hit on observation 3

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [AB.sub(1), AB.sub(1), AB.add(1)];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // reserve ratio / locked amount check
        const reserveRatio = initialSpotPrice
          .sub(strikePrice)
          .mul(10 ** OTOKEN_DECIMALS)
          .div(initialSpotPrice);

        const lockedAmount = (await vault.vaultState())[1];

        assert.equal(
          lockedAmount
            .mul(10 ** OTOKEN_DECIMALS)
            .div(depositAmount)
            .toString(),
          (10 ** OTOKEN_DECIMALS - reserveRatio).toString()
        );

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );

        // Out of 5 coupons 3 went to the user and 2 are returned to the MM/autocall seller
        const returnAmt = premiumAmount.div(numTotalObs).mul(2);
        assert.equal(
          mmUSDCBalAfter.sub(mmUSDCBalBefore).toString(),
          returnAmt.sub(premiumAmount).toString()
        );

        // user transfers the deposit amount
        const earnedAmt = premiumAmount.div(numTotalObs).mul(3);
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit plus the earned amount
        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // since it was an early termination all unexpired oTokens were burned
        assert.bnGt(vaultOtokenBalBefore, 0);
        assert.equal(vaultOtokenBalAfter, 0);

        // user vault account balance increases by the earned amount
        assert.equal(
          (await vault.accountVaultBalance(user)).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 1); // optionType
        assert.equal((await vault.putOption())[1], 1); // nOptionType
        assert.equal(
          (await vault.putOption())[2].toString(),
          initialSpotPrice
            .sub(strikePrice)
            .mul(10 ** tokenDecimals)
            .div(10 ** OTOKEN_DECIMALS)
            .toString()
        ); // payoff
      });

      it("successfully commit and closes an autocall with VANILLA coupon and LEVERED downside earlier than maturity", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await vault.connect(ownerSigner).setOptionType(2);
        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is hit on observation 3

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [AB.sub(1), AB.sub(1), AB.add(1)];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // reserve ratio / locked amount check
        const lockedAmount = (await vault.vaultState())[1];
        assert.equal(lockedAmount.toString(), depositAmount); // levered

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );

        // Out of 5 coupons 3 went to the user and 2 are returned to the MM/autocall seller
        const returnAmt = premiumAmount.div(numTotalObs).mul(2);
        assert.equal(
          mmUSDCBalAfter.sub(mmUSDCBalBefore).toString(),
          returnAmt.sub(premiumAmount).toString()
        );

        // user transfers the deposit amount
        const earnedAmt = premiumAmount.div(numTotalObs).mul(3);
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit plus the earned amount
        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // since it was an early termination all unexpired oTokens were burned
        assert.bnGt(vaultOtokenBalBefore, 0);
        assert.equal(vaultOtokenBalAfter, 0);

        // user vault account balance increases by the earned amount
        assert.equal(
          (await vault.accountVaultBalance(user)).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 2); // optionType
        assert.equal((await vault.putOption())[1], 2); // nOptionType
        assert.equal((await vault.putOption())[2], 0); // payoff
      });

      it("successfully commit and closes an autocall with VANILLA coupon and VANILLA downside after maturity OTM", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
        const strikePrice = await currentOtoken.strikePrice();

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is hit on the last observation (observation 5)

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.add(1),
        ];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // Increase beyond dispute period
        await time.increase(ORACLE_DISPUTE_PERIOD);

        // otokens are sent to MM
        await vault.connect(ownerSigner).sendOTokens(autocallSeller);

        // reserve ratio / locked amount check
        const reserveRatio = initialSpotPrice
          .sub(strikePrice)
          .mul(10 ** OTOKEN_DECIMALS)
          .div(initialSpotPrice);

        const lockedAmount = (await vault.vaultState())[1];

        assert.equal(
          lockedAmount
            .mul(10 ** OTOKEN_DECIMALS)
            .div(depositAmount)
            .toString(),
          (10 ** OTOKEN_DECIMALS - reserveRatio).toString()
        );

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );
        const mmOtokenBal = await currentOtoken.balanceOf(autocallSeller);

        // Out of 5 coupons all 5 went to the user and none are returned to the MM/autocall seller
        assert.equal(
          mmUSDCBalBefore.sub(mmUSDCBalAfter).toString(),
          premiumAmount.toString()
        );

        // user transfers the deposit amount
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit plus the earned amount
        const earnedAmt = premiumAmount;
        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // user vault account balance increases by the earned amount
        assert.equal(
          (await vault.accountVaultBalance(user)).toString(),
          depositAmount.add(earnedAmt).toString()
        );

        // otokens are not burned and are sent from the vault to MM/autocall seller
        assert.equal(mmOtokenBal.toString(), vaultOtokenBalBefore.toString());
        assert.equal(vaultOtokenBalAfter, 0);

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 0); // optionType
        assert.equal((await vault.putOption())[1], 0); // nOptionType
        assert.equal((await vault.putOption())[2], 0); // payoff
      });

      it("successfully commit and closes an autocall with VANILLA coupon and VANILLA downside after maturity ITM", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
        const strikePrice = await currentOtoken.strikePrice();
        const priceAtExpiry = strikePrice.div(2);

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is never hit and last observation is below strike price

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          priceAtExpiry,
        ];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // Increase beyond dispute period
        await time.increase(ORACLE_DISPUTE_PERIOD);

        // otokens are sent to MM
        await vault.connect(ownerSigner).sendOTokens(autocallSeller);

        // reserve ratio / locked amount check
        const reserveRatio = initialSpotPrice
          .sub(strikePrice)
          .mul(10 ** OTOKEN_DECIMALS)
          .div(initialSpotPrice);

        const lockedAmount = (await vault.vaultState())[1];

        assert.equal(
          lockedAmount
            .mul(10 ** OTOKEN_DECIMALS)
            .div(depositAmount)
            .toString(),
          (10 ** OTOKEN_DECIMALS - reserveRatio).toString()
        );

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );
        const mmOtokenBal = await currentOtoken.balanceOf(autocallSeller);

        // Out of 5 coupons all 0 went to the user and all are returned to the MM/autocall seller
        assert.equal(mmUSDCBalAfter.sub(mmUSDCBalBefore).toString(), 0);

        // user transfers the deposit amount
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit and loses the ITM payout to MM
        const payoutITM = mmOtokenBal
          .mul(strikePrice.sub(priceAtExpiry))
          .div(10 ** (8 + 8 - params.tokenDecimals)); // 10**8 is otoken and price decimals

        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.sub(payoutITM).toString()
        );

        // user vault account balance decreases by the ITM payout amount
        assert.bnLt(
          await vault.accountVaultBalance(user),
          depositAmount.sub(payoutITM).mul(100001).div(100000)
        );

        assert.bnGt(
          await vault.accountVaultBalance(user),
          depositAmount.sub(payoutITM).mul(99999).div(100000)
        );

        // otokens are not burned and are sent from the vault and to MM/autocall seller
        assert.equal(mmOtokenBal.toString(), vaultOtokenBalBefore.toString());
        assert.equal(vaultOtokenBalAfter, 0);
        const oTokenBal = depositAmount.mul(10 ** 10).div(initialSpotPrice);
        assert.bnLt(mmOtokenBal, oTokenBal.mul(100001).div(100000));
        assert.bnGt(mmOtokenBal, oTokenBal.mul(99999).div(100000));

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 0); // optionType
        assert.equal((await vault.putOption())[1], 0); // nOptionType
        assert.equal((await vault.putOption())[2], 0); // payoff

        console.log("initialSpotPrice", initialSpotPrice.toString());
        console.log("strikePrice", strikePrice.toString());
        console.log("priceAtExpiry", priceAtExpiry.toString());
        console.log("depositAmount", depositAmount.toString());
        console.log("mmOtokenBal", mmOtokenBal.toString());
        console.log("vaultUSDCBalAfter", vaultUSDCBalAfter.toString());
        console.log("payoutITM", payoutITM.toString());
      });

      it("successfully commit and closes an autocall with VANILLA coupon and DIP downside after maturity OTM", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await vault.connect(ownerSigner).setOptionType(1);
        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
        const strikePrice = await currentOtoken.strikePrice();

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is never and last observation is just above strike price (observation 5)

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          strikePrice.add(1),
        ];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // Increase beyond dispute period
        await time.increase(ORACLE_DISPUTE_PERIOD);

        // otokens are sent to MM
        await vault.connect(ownerSigner).sendOTokens(autocallSeller);

        // reserve ratio / locked amount check
        const reserveRatio = initialSpotPrice
          .sub(strikePrice)
          .mul(10 ** OTOKEN_DECIMALS)
          .div(initialSpotPrice);

        const lockedAmount = (await vault.vaultState())[1];

        assert.equal(
          lockedAmount
            .mul(10 ** OTOKEN_DECIMALS)
            .div(depositAmount)
            .toString(),
          (10 ** OTOKEN_DECIMALS - reserveRatio).toString()
        );

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );
        const mmOtokenBal = await currentOtoken.balanceOf(autocallSeller);

        // Out of 5 coupons zero went to the user and all 5 are returned to the MM/autocall seller
        assert.equal(mmUSDCBalBefore.sub(mmUSDCBalAfter).toString(), 0);

        // user transfers the deposit amount
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit
        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.toString()
        );

        // user vault account balance stays the same as the deposited amount
        assert.equal(
          (await vault.accountVaultBalance(user)).toString(),
          depositAmount.toString()
        );

        // otokens are not burned and are sent from the vault and to MM/autocall seller
        assert.equal(mmOtokenBal.toString(), vaultOtokenBalBefore.toString());
        assert.equal(vaultOtokenBalAfter, 0);

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 1); // optionType
        assert.equal((await vault.putOption())[1], 1); // nOptionType
        assert.equal(
          (await vault.putOption())[2].toString(),
          initialSpotPrice
            .sub(strikePrice)
            .mul(10 ** tokenDecimals)
            .div(10 ** OTOKEN_DECIMALS)
            .toString()
        ); // payoff
      });

      it("successfully commit and closes an autocall with VANILLA coupon and DIP downside after maturity ITM", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await vault.connect(ownerSigner).setOptionType(1);
        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
        const strikePrice = await currentOtoken.strikePrice();
        const priceAtExpiry = strikePrice.div(2);

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is never hit and last observation is below strike price

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          priceAtExpiry,
        ];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // Increase beyond dispute period
        await time.increase(ORACLE_DISPUTE_PERIOD);

        // otokens are sent to MM
        await vault.connect(ownerSigner).sendOTokens(autocallSeller);

        // reserve ratio / locked amount check
        const reserveRatio = initialSpotPrice
          .sub(strikePrice)
          .mul(10 ** OTOKEN_DECIMALS)
          .div(initialSpotPrice);

        const lockedAmount = (await vault.vaultState())[1];

        assert.equal(
          lockedAmount
            .mul(10 ** OTOKEN_DECIMALS)
            .div(depositAmount)
            .toString(),
          (10 ** OTOKEN_DECIMALS - reserveRatio).toString()
        );

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );
        const mmOtokenBal = await currentOtoken.balanceOf(autocallSeller);

        const payoutITM = mmOtokenBal
          .mul(strikePrice.sub(priceAtExpiry))
          .div(10 ** (8 + 8 - params.tokenDecimals)); // 10**8 is otoken and price decimals

        const additionalPayoutDIP = mmOtokenBal
          .mul(initialSpotPrice.sub(strikePrice))
          .div(10 ** (8 + 8 - params.tokenDecimals));

        // Out of 5 coupons 0 went to the user and all are returned to the MM/autocall seller plus the DIP payoff which is sent directly to him/her
        assert.equal(
          mmUSDCBalAfter.sub(mmUSDCBalBefore).toString(),
          additionalPayoutDIP.toString()
        );

        // user transfers the deposit amount
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit and loses the ITM payout to MM
        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.sub(payoutITM).sub(additionalPayoutDIP).toString()
        );

        // user vault account balance decreases by the ITM VANILLA payout plus DIP payout amount
        assert.bnLt(
          await vault.accountVaultBalance(user),
          depositAmount
            .sub(payoutITM)
            .sub(additionalPayoutDIP)
            .mul(100001)
            .div(100000)
        );

        assert.bnGt(
          await vault.accountVaultBalance(user),
          depositAmount
            .sub(payoutITM)
            .sub(additionalPayoutDIP)
            .mul(99999)
            .div(100000)
        );

        // otokens are not burned and are sent from the vault and to MM/autocall seller
        assert.equal(mmOtokenBal.toString(), vaultOtokenBalBefore.toString());
        assert.equal(vaultOtokenBalAfter, 0);

        const oTokenBal = depositAmount.mul(10 ** 10).div(initialSpotPrice); // 8 decimals for price plus 2 decimals to adjust for USDC that only has 6 decimals
        assert.bnLt(mmOtokenBal, oTokenBal.mul(100001).div(100000));
        assert.bnGt(mmOtokenBal, oTokenBal.mul(99999).div(100000));

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 1); // optionType
        assert.equal((await vault.putOption())[1], 1); // nOptionType
        assert.equal(
          (await vault.putOption())[2].toString(),
          initialSpotPrice
            .sub(strikePrice)
            .mul(10 ** tokenDecimals)
            .div(10 ** OTOKEN_DECIMALS)
            .toString()
        ); // payoff

        console.log("initialSpotPrice", initialSpotPrice.toString());
        console.log("strikePrice", strikePrice.toString());
        console.log("priceAtExpiry", priceAtExpiry.toString());
        console.log("depositAmount", depositAmount.toString());
        console.log("mmOtokenBal", mmOtokenBal.toString());
        console.log("vaultUSDCBalAfter", vaultUSDCBalAfter.toString());
        console.log("payoutITM (1/2)", payoutITM.toString());
        console.log(
          "additionalPayoutDIP (2/2)",
          additionalPayoutDIP.toString()
        );
      });

      it("successfully commit and closes an autocall with VANILLA coupon and LEVERED downside after maturity ITM", async function () {
        // balances before
        const mmUSDCBalBefore = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalBefore = await premiumContract.balanceOf(user);
        const vaultUSDCBalBefore = await premiumContract.balanceOf(
          vault.address
        );

        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.connect(userSigner).deposit(depositAmount);

        await vault.connect(ownerSigner).setOptionType(2);
        await rollToNextOption();

        const currentOtoken = await getContractAt(
          "IOtoken",
          await vault.currentOption()
        );

        const vaultOtokenBalBefore = await currentOtoken.balanceOf(
          vault.address
        );

        const premiumAmount = BigNumber.from("5000000000"); // 1000 USDC
        const numTotalObs = await vault.numTotalObs(); // 5 total observations
        obsFreq = BigNumber.from("518400"); // 6 days
        const strikePrice = await currentOtoken.strikePrice();
        const priceAtExpiry = strikePrice.div(2);

        await premiumContract
          .connect(autocallSellerSigner)
          .transfer(vault.address, premiumAmount);

        const initialSpotPrice = await vault.initialSpotPrice();
        const AB = (await vault.couponState())[2]
          .mul(initialSpotPrice)
          .div(PCT_MULTIPLIER);

        // set prices for observation such that autocall barrier is never hit and last observation is below strike price

        const expiry = await currentOtoken.expiryTimestamp();

        const observations = [];
        const expirationPrices = [
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          AB.sub(1),
          priceAtExpiry,
        ];

        for (let i = 0; i < expirationPrices.length; i++) {
          const obs = expiry - numTotalObs.sub(BigNumber.from(i + 1)) * obsFreq;
          observations.push(obs);

          await time.increase(obsFreq.add(1));
          await oracle
            .connect(pricerSigner)
            .setExpiryPrice(params.asset, observations[i], expirationPrices[i]);
        }

        // Increase beyond dispute period
        await time.increase(ORACLE_DISPUTE_PERIOD);

        // otokens are sent to MM
        await vault.connect(ownerSigner).sendOTokens(autocallSeller);

        // reserve ratio / locked amount check
        const lockedAmount = (await vault.vaultState())[1];
        assert.equal(lockedAmount.toString(), depositAmount); // levered

        await vault.commitAndClose();

        const mmUSDCBalAfter = await premiumContract.balanceOf(autocallSeller);
        const userUSDCBalAfter = await premiumContract.balanceOf(user);
        const vaultUSDCBalAfter = await premiumContract.balanceOf(
          vault.address
        );
        const vaultOtokenBalAfter = await currentOtoken.balanceOf(
          vault.address
        );
        const mmOtokenBal = await currentOtoken.balanceOf(autocallSeller);

        const payoutITM = mmOtokenBal
          .mul(strikePrice.sub(priceAtExpiry))
          .div(10 ** (8 + 8 - params.tokenDecimals)); // 10**8 is otoken and price decimals

        // Out of 5 coupons 0 went to the user and all are returned to the MM/autocall
        assert.equal(mmUSDCBalAfter.sub(mmUSDCBalBefore).toString(), 0);

        // user transfers the deposit amount
        assert.equal(
          userUSDCBalBefore.sub(userUSDCBalAfter).toString(),
          depositAmount.toString()
        );

        // vault receives deposit and loses the ITM payout to MM
        assert.equal(
          vaultUSDCBalAfter.sub(vaultUSDCBalBefore).toString(),
          depositAmount.sub(payoutITM).toString()
        );

        // user vault account balance decreases by the ITM payout
        assert.equal(
          (await vault.accountVaultBalance(user)).toString(),
          depositAmount.sub(payoutITM).toString()
        );

        // otokens are not burned and are sent from the vault and to MM/autocall seller
        assert.equal(mmOtokenBal.toString(), vaultOtokenBalBefore.toString());
        assert.equal(vaultOtokenBalAfter, 0);

        const oTokenBal = depositAmount.mul(10 ** 10).div(strikePrice); // 8 decimals for price plus 2 decimals to adjust for USDC that only has 6 decimals
        assert.equal(mmOtokenBal.toString(), oTokenBal.toString());

        // state changes
        assert.equal((await vault.couponState())[0], 3); // couponType
        assert.equal((await vault.couponState())[1], 3); // nCouponType
        assert.equal((await vault.couponState())[2], 10500); // AB
        assert.equal((await vault.couponState())[3], 10500); // nAB
        assert.equal((await vault.couponState())[4], 10500); // CB
        assert.equal((await vault.couponState())[5], 10500); // nCB
        assert.equal(await vault.obsFreq(), 518400);
        assert.equal(await vault.period(), 30);
        assert.equal(await vault.numTotalObs(), 5);
        assert.equal((await vault.putOption())[0], 2); // optionType
        assert.equal((await vault.putOption())[1], 2); // nOptionType
        assert.equal((await vault.putOption())[2], 0); // payoff

        console.log("initialSpotPrice", initialSpotPrice.toString());
        console.log("strikePrice", strikePrice.toString());
        console.log("priceAtExpiry", priceAtExpiry.toString());
        console.log("depositAmount", depositAmount.toString());
        console.log("mmOtokenBal", mmOtokenBal.toString());
        console.log("vaultUSDCBalAfter", vaultUSDCBalAfter.toString());
        console.log("payoutITM", payoutITM.toString());
      });
    });
  });
}

async function approve(
  assetContract: Contract,
  vault: Contract,
  amount: BigNumberish,
  signer?: SignerWithAddress
) {
  await assetContract.connect(signer).approve(vault.address, amount);
}
