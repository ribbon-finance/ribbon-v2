import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, constants, Contract } from "ethers";
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
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  USDC_OWNER_ADDRESS,
  WETH_ADDRESS,
  OptionsPremiumPricerInStables_BYTECODE,
  PERP_ETH_POOL,
  PERP_PRICE_ORACLE,
  PERP_OWNER_ADDRESS,
  PERP_ADDRESS,
  CHAINLINK_PERP_PRICER,
  BADGER_ETH_POOL,
  BADGER_PRICE_ORACLE,
  BADGER_OWNER_ADDRESS,
  BADGER_ADDRESS,
  CHAINLINK_BADGER_PRICER,
  BAL_ETH_POOL,
  BAL_PRICE_ORACLE,
  BAL_OWNER_ADDRESS,
  BAL_ADDRESS,
  CHAINLINK_BAL_PRICER,
  SPELL_ETH_POOL,
  SPELL_PRICE_ORACLE,
  SPELL_OWNER_ADDRESS,
  SPELL_ADDRESS,
  CHAINLINK_SPELL_PRICER,
  ManualVolOracle_BYTECODE,
  AIRSWAP_CONTRACT,
} from "../constants/constants";
import {
  deployProxy,
  setupOracle,
  setOpynOracleExpiryPrice,
  whitelistProduct,
  mintToken,
  lockedBalanceForRollover,
  addMinter,
  getBlockNum,
  signOrderForAirSwap,
} from "./helpers/utils";
import { wmul } from "./helpers/math";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "./helpers/assertions";
import { TEST_URI } from "../scripts/helpers/getDefaultEthersProvider";
import {
  PERP_STRIKE_MULTIPLIER,
  BADGER_STRIKE_MULTIPLIER,
  BAL_STRIKE_MULTIPLIER,
  SPELL_STRIKE_MULTIPLIER,
  STRIKE_STEP,
} from "../scripts/utils/constants";
const { provider, getContractAt, getContractFactory } = ethers;
const { parseEther } = ethers.utils;

moment.tz.setDefault("UTC");

const OPTION_DELAY = 0;
const DELAY_INCREMENT = 100;
const gasPrice = parseUnits("1", "gwei");
const FEE_SCALING = BigNumber.from(10).pow(6);
const WEEKS_PER_YEAR = 52142857;

const chainId = network.config.chainId;

describe("RibbonTreasuryVaultWithAirSwap", () => {
  behavesLikeRibbonOptionsVault({
    name: `Ribbon PERP Treasury Vault (Call)`,
    tokenName: "Ribbon PERP Treasury Vault",
    tokenSymbol: "rPERP-TSRY",
    asset: PERP_ADDRESS[chainId],
    assetContractName: "IPERP",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: PERP_ADDRESS[chainId],
    chainlinkPricer: CHAINLINK_PERP_PRICER[chainId],
    deltaStep: BigNumber.from(STRIKE_STEP.PERP),
    depositAmount: parseEther("20"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("2000000000"),
    managementFee: BigNumber.from("0"),
    performanceFee: BigNumber.from("20000000"),
    manualStrikePrice: BigNumber.from("1").pow("8"),
    tokenDecimals: 18,
    isPut: false,
    gasLimits: {
      depositWorstCase: 161000,
      depositBestCase: 95000,
    },
    mintConfig: {
      contractOwnerAddress: PERP_OWNER_ADDRESS[chainId],
    },
    period: 30,
    pool: PERP_ETH_POOL[chainId],
    oracle: PERP_PRICE_ORACLE[chainId],
    premiumInStables: true,
    multiplier: PERP_STRIKE_MULTIPLIER,
    premiumDecimals: 6,
    maxDepositors: 30,
    minDeposit: parseUnits("1", 18),
    availableChains: [CHAINID.ETH_MAINNET],
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon BADGER Treasury Vault (Call)`,
    tokenName: "Ribbon BADGER Treasury Vault",
    tokenSymbol: "rBADGER-TSRY",
    asset: BADGER_ADDRESS[chainId],
    assetContractName: "IWETH",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: BADGER_ADDRESS[chainId],
    chainlinkPricer: CHAINLINK_BADGER_PRICER[chainId],
    deltaStep: BigNumber.from(STRIKE_STEP.BADGER),
    depositAmount: parseEther("20"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("2000000000"),
    managementFee: BigNumber.from("0"),
    performanceFee: BigNumber.from("20000000"),
    manualStrikePrice: BigNumber.from("3").pow("8"),
    tokenDecimals: 18,
    isPut: false,
    gasLimits: {
      depositWorstCase: 233691,
      depositBestCase: 171670,
    },
    mintConfig: {
      contractOwnerAddress: BADGER_OWNER_ADDRESS[chainId],
    },
    period: 30,
    pool: BADGER_ETH_POOL[chainId],
    oracle: BADGER_PRICE_ORACLE[chainId],
    premiumInStables: true,
    multiplier: BADGER_STRIKE_MULTIPLIER,
    premiumDecimals: 6,
    maxDepositors: 30,
    minDeposit: parseUnits("1", 18),
    availableChains: [CHAINID.ETH_MAINNET],
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon BAL Treasury Vault (Call)`,
    tokenName: "Ribbon BAL Treasury Vault",
    tokenSymbol: "rBAL-TSRY",
    asset: BAL_ADDRESS[chainId],
    assetContractName: "IWETH",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: BAL_ADDRESS[chainId],
    chainlinkPricer: CHAINLINK_BAL_PRICER[chainId],
    deltaStep: BigNumber.from(STRIKE_STEP.BAL),
    depositAmount: parseEther("20"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("2000000000"),
    managementFee: BigNumber.from("0"),
    performanceFee: BigNumber.from("20000000"),
    manualStrikePrice: BigNumber.from("1").pow("8"),
    tokenDecimals: 18,
    isPut: false,
    gasLimits: {
      depositWorstCase: 169000,
      depositBestCase: 102201,
    },
    mintConfig: {
      contractOwnerAddress: BAL_OWNER_ADDRESS[chainId],
    },
    period: 30,
    pool: BAL_ETH_POOL[chainId],
    oracle: BAL_PRICE_ORACLE[chainId],
    premiumInStables: true,
    multiplier: BAL_STRIKE_MULTIPLIER,
    premiumDecimals: 6,
    maxDepositors: 30,
    minDeposit: parseUnits("1", 18),
    availableChains: [CHAINID.ETH_MAINNET],
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon SPELL Treasury Vault (Call)`,
    tokenName: "Ribbon SPELL Treasury Vault",
    tokenSymbol: "rSPELL-TSRY",
    asset: SPELL_ADDRESS[chainId],
    assetContractName: "IWETH",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: SPELL_ADDRESS[chainId],
    chainlinkPricer: CHAINLINK_SPELL_PRICER[chainId],
    deltaStep: BigNumber.from(STRIKE_STEP.SPELL),
    depositAmount: parseEther("100000"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("10000000000000"),
    managementFee: BigNumber.from("0"),
    performanceFee: BigNumber.from("20000000"),
    manualStrikePrice: BigNumber.from("1").pow("8"),
    tokenDecimals: 18,
    isPut: false,
    gasLimits: {
      depositWorstCase: 169000,
      depositBestCase: 102201,
    },
    mintConfig: {
      contractOwnerAddress: SPELL_OWNER_ADDRESS[chainId],
    },
    period: 30,
    pool: SPELL_ETH_POOL[chainId],
    oracle: SPELL_PRICE_ORACLE[chainId],
    premiumInStables: true,
    multiplier: SPELL_STRIKE_MULTIPLIER,
    premiumDecimals: 6,
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
 * @param {BigNumber} params.managementFee - Management fee (6 decimals)
 * @param {BigNumber} params.performanceFee - PerformanceFee fee (6 decimals)
 * @param {boolean} params.isPut - Boolean flag for if the vault sells call or put options
 * @param {number[]} params.availableChains - ChainIds where the tests for the vault will be executed
 * @param {number} params.premiumDecimals: - Decimals of premiumAsset
 * @param {number} params.maxDepositors: - Max. depositors allowed
 * @param {BigNumber} params.minDeposit: - Minimum deposit per depositor
 * @param {number} params.premiumInStables: - Boolean flag whether premium is denominated in stables
 * @param {number} params.pool: - Uniswap v3 pool for the underlying asset
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
  premiumDecimals: number;
  manualStrikePrice: BigNumber;
  period: number;
  pool: string;
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
  let owner: string, keeper: string, user: string, feeRecipient: string;

  // Signers
  let adminSigner: SignerWithAddress,
    userSigner: SignerWithAddress,
    ownerSigner: SignerWithAddress,
    keeperSigner: SignerWithAddress,
    feeRecipientSigner: SignerWithAddress;

  // Private keys
  let userSignerPrivateKey: string;
  let keeperSignerPrivateKey: string;

  // Parameters
  let tokenName = params.tokenName;
  let tokenSymbol = params.tokenSymbol;
  let tokenDecimals = params.tokenDecimals;
  let minimumSupply = params.minimumSupply;
  let asset = params.asset;
  let collateralAsset = params.collateralAsset;
  let depositAmount = params.depositAmount;
  let managementFee = params.managementFee;
  let performanceFee = params.performanceFee;
  // let expectedMintAmount = params.expectedMintAmount;
  let isPut = params.isPut;
  let premiumDecimals = params.premiumDecimals;
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
  let airswapContract: Contract;

  // Variables
  let defaultOtokenAddress: string;
  let firstOptionStrike: BigNumber;
  let firstOptionPremium: BigNumber;
  let firstOptionExpiry: number;
  let secondOptionStrike: BigNumber;
  let secondOptionExpiry: number;
  let optionId: string;

  describe(`${params.name}`, () => {
    let initSnapshotId: string;
    let firstOption: Option;
    let secondOption: Option;

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

      [userSigner, ownerSigner, keeperSigner, adminSigner, feeRecipientSigner] =
        await ethers.getSigners();
      owner = ownerSigner.address;
      keeper = keeperSigner.address;
      user = userSigner.address;
      feeRecipient = feeRecipientSigner.address;

      userSignerPrivateKey =
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

      keeperSignerPrivateKey =
        "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

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

      const VaultLifecycleTreasuryWithAirSwap = await ethers.getContractFactory(
        "VaultLifecycleTreasuryWithAirSwap"
      );
      vaultLifecycleTreasuryLib =
        await VaultLifecycleTreasuryWithAirSwap.deploy();

      const initializeArgs = [
        [
          owner,
          keeper,
          feeRecipient,
          managementFee,
          performanceFee,
          tokenName,
          tokenSymbol,
          strikeSelection.address,
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
      ];

      const deployArgs = [
        WETH_ADDRESS[chainId],
        USDC_ADDRESS[chainId],
        OTOKEN_FACTORY[chainId],
        GAMMA_CONTROLLER[chainId],
        MARGIN_POOL[chainId],
        AIRSWAP_CONTRACT[chainId],
      ];

      vault = (
        await deployProxy(
          "RibbonTreasuryVaultWithAirSwap",
          adminSigner,
          initializeArgs,
          deployArgs,
          {
            libraries: {
              VaultLifecycleTreasuryWithAirSwap:
                vaultLifecycleTreasuryLib.address,
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
      if (period === 30) {
        firstOptionExpiry = moment(latestTimestamp * 1000)
          .add(chainId === CHAINID.AVAX_MAINNET ? 0 : 1, "weeks")
          .endOf("month")
          .day(5)
          .add(-7, "day")
          .hours(8)
          .minutes(0)
          .seconds(0)
          .unix();
      } else if (period === 90 || period === 180) {
        firstOptionExpiry = moment(latestTimestamp * 1000)
          .month("dec")
          .date(31)
          .hours(8)
          .minutes(0)
          .seconds(0)
          .unix();
      } else {
        firstOptionExpiry = moment(latestTimestamp * 1000)
          .startOf("isoWeek")
          .day(5)
          .hours(8)
          .minutes(0)
          .seconds(0)
          .unix();
      }

      [firstOptionStrike] = await strikeSelection.getStrikePrice(
        firstOptionExpiry,
        params.isPut
      );

      firstOptionPremium = BigNumber.from(
        await optionsPremiumPricer.getPremiumInStables(
          firstOptionStrike,
          firstOptionExpiry,
          params.isPut
        )
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
      if (period === 30) {
        secondOptionExpiry = moment(latestTimestamp * 1000)
          .endOf("month")
          .add(chainId === CHAINID.AVAX_MAINNET ? 0 : 1, "weeks")
          .add(asset === SPELL_ADDRESS[chainId] ? 0 : 1, "month")
          .endOf("month")
          .add(-1, "week")
          .day(5)
          .hours(8)
          .minutes(0)
          .seconds(0)
          .unix();
      } else if (period === 90) {
        secondOptionExpiry = moment(latestTimestamp * 1000)
          .year(2022)
          .month("march")
          .date(25)
          .hours(8)
          .minutes(0)
          .seconds(0)
          .unix();
      } else if (period === 180) {
        secondOptionExpiry = moment(latestTimestamp * 1000)
          .year(2022)
          .month("june")
          .date(24)
          .hours(8)
          .minutes(0)
          .seconds(0)
          .unix();
      } else {
        secondOptionExpiry = moment(latestTimestamp * 1000)
          .startOf("isoWeek")
          .add(period / 7, "weeks")
          .day(5)
          .hours(8)
          .minutes(0)
          .seconds(0)
          .unix();
      }

      [secondOptionStrike] = await strikeSelection.getStrikePrice(
        secondOptionExpiry,
        params.isPut
      );

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
        collateralAsset
      );

      if (premiumAsset === WETH_ADDRESS[chainId]) {
        premiumContract = await getContractAt("IWETH", premiumAsset);
      } else {
        premiumContract = await getContractAt("IERC20", premiumAsset);
      }

      airswapContract = await getContractAt(
        "IAirSwap",
        AIRSWAP_CONTRACT[chainId]
      );

      // If mintable token, then mine the token
      if (params.mintConfig) {
        const addressToDeposit = [
          userSigner,
          ownerSigner,
          adminSigner,
          keeperSigner,
        ];

        if (asset === PERP_ADDRESS[chainId]) {
          await addMinter(
            assetContract,
            params.mintConfig.contractOwnerAddress,
            params.mintConfig.contractOwnerAddress
          );
        }

        let toMint = parseEther("200");

        if (params.collateralAsset === USDC_ADDRESS[chainId]) {
          toMint = BigNumber.from("10000000000000");
        } else if (params.collateralAsset === SPELL_ADDRESS[chainId]) {
          toMint = parseEther("10000000");
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
    });

    after(async () => {
      await time.revertToSnapShot(initSnapshotId);
    });

    describe("#initialize", () => {
      let testVault: Contract;

      time.revertToSnapshotAfterEach(async function () {
        const RibbonTreasuryVaultWithAirSwap = await ethers.getContractFactory(
          "RibbonTreasuryVaultWithAirSwap",
          {
            libraries: {
              VaultLifecycleTreasuryWithAirSwap:
                vaultLifecycleTreasuryLib.address,
            },
          }
        );
        testVault = await RibbonTreasuryVaultWithAirSwap.deploy(
          WETH_ADDRESS[chainId],
          USDC_ADDRESS[chainId],
          OTOKEN_FACTORY[chainId],
          GAMMA_CONTROLLER[chainId],
          MARGIN_POOL[chainId],
          AIRSWAP_CONTRACT[chainId]
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
        assert.equal(await vault.maxDepositors(), maxDepositors);
        assert.equal(await decimals, tokenDecimals);
        assert.equal(decimals, tokenDecimals);
        assert.equal(assetFromContract, collateralAsset);
        assert.equal(underlying, asset);
        assert.equal(await vault.WETH(), WETH_ADDRESS[chainId]);
        assert.equal(await vault.USDC(), USDC_ADDRESS[chainId]);
        assert.bnEqual(await vault.totalPending(), BigNumber.from(0));
        assert.equal(minimumSupply, params.minimumSupply);
        assert.equal(isPut, params.isPut);
        assert.bnEqual(cap, parseEther("2000000"));
        assert.equal(await vault.strikeSelection(), strikeSelection.address);
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
              strikeSelection.address,
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
              strikeSelection.address,
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
            ]
          )
        ).to.be.revertedWith("!_owner");
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
              strikeSelection.address,
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
            ]
          )
        ).to.be.revertedWith("!_keeper");
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
              strikeSelection.address,
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
            ]
          )
        ).to.be.revertedWith("!_feeRecipient");
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
              strikeSelection.address,
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
              0,
            ]
          )
        ).to.be.revertedWith("!cap");
      });

      it("reverts when asset is 0x", async function () {
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
              strikeSelection.address,
              period,
              maxDepositors,
              minDeposit,
            ],
            [
              isPut,
              tokenDecimals,
              constants.AddressZero,
              asset,
              minimumSupply,
              parseEther("2000000"),
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
          managementFee
            .mul(FEE_SCALING)
            .div(
              period % 30 === 0
                ? FEE_SCALING.mul(12 / (period / 30))
                : BigNumber.from(WEEKS_PER_YEAR).div(period / 7)
            )
            .toString()
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

    describe("#setStrikeSelection", () => {
      time.revertToSnapshotAfterTest();

      it("set new strike selection contract to owner", async function () {
        assert.equal(await vault.strikeSelection(), strikeSelection.address);
        await vault.connect(ownerSigner).setStrikeSelection(owner);
        assert.equal(await vault.strikeSelection(), owner);
      });

      it("reverts when not owner call", async function () {
        await expect(vault.setStrikeSelection(owner)).to.be.revertedWith(
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
            .div(
              period % 30 === 0
                ? FEE_SCALING.mul(12 / (period / 30))
                : BigNumber.from(WEEKS_PER_YEAR).div(period / 7)
            )
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

    describe("#setMaxDepositors", () => {
      time.revertToSnapshotAfterTest();

      it("reverts when not owner call", async function () {
        await expect(
          vault.setMaxDepositors(BigNumber.from("10").toString())
        ).to.be.revertedWith("caller is not the owner");
      });

      it("reverts when not larger than 0", async function () {
        await expect(
          vault
            .connect(ownerSigner)
            .setMaxDepositors(BigNumber.from("0").toString())
        ).to.be.revertedWith("!newMaxDepositors");
      });

      it("changes the maximum depositors", async function () {
        await vault
          .connect(ownerSigner)
          .setMaxDepositors(BigNumber.from("10").toString());
        assert.equal((await vault.maxDepositors()).toString(), "10");
      });
    });

    describe("#deposit", () => {
      time.revertToSnapshotAfterEach();

      beforeEach(async function () {
        // Deposit only if asset is WETH
        if (params.collateralAsset === WETH_ADDRESS[chainId]) {
          const addressToDeposit = [userSigner, ownerSigner, adminSigner];

          for (let i = 0; i < addressToDeposit.length; i++) {
            const weth = assetContract.connect(addressToDeposit[i]);
            await weth.deposit({ value: parseEther("10") });
            await weth.approve(vault.address, parseEther("10"));
          }
        }
      });

      it("reverts when deposit does not reach the minimum", async function () {
        await expect(
          vault.connect(userSigner).deposit(minDeposit.div(100))
        ).to.be.revertedWith("Minimum deposit not reached");
      });

      it("creates a pending deposit", async function () {
        const startBalance = await assetContract.balanceOf(user);

        await approve(assetContract, vault, depositAmount, userSigner);

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
        const totalDepositAmount = depositAmount.add(depositAmount.div(2));

        await approve(assetContract, vault, totalDepositAmount, userSigner);

        await vault.deposit(depositAmount);

        const tx = await vault.deposit(depositAmount.div(2));

        assert.bnEqual(
          await assetContract.balanceOf(user),
          startBalance.sub(totalDepositAmount)
        );
        assert.isTrue((await vault.totalSupply()).isZero());
        assert.isTrue((await vault.balanceOf(user)).isZero());
        await expect(tx)
          .to.emit(vault, "Deposit")
          .withArgs(user, depositAmount.div(2), 1);

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
        await assetContract
          .connect(adminSigner)
          .transfer(vault.address, depositAmount.mul(10));

        await vault.connect(userSigner).deposit(depositAmount);

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
        await approve(
          assetContract,
          vault,
          params.depositAmount.mul(2),
          userSigner
        );

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
        assert.bnEqual(
          await vault.balanceOf(vault.address),
          params.depositAmount
        );

        const {
          round: round3,
          amount: amount3,
          unredeemedShares: unredeemedShares3,
        } = await vault.depositReceipts(user);

        assert.equal(round3, 2);
        assert.bnEqual(amount3, params.depositAmount);
        assert.bnEqual(unredeemedShares3, params.depositAmount);
      });

      it("adds depositor to list and mapping", async function () {
        await approve(
          assetContract,
          vault,
          params.depositAmount.mul(2),
          userSigner
        );
        await vault.deposit(params.depositAmount);

        assert.equal(await vault.depositorsArray(0), user);
        assert.equal(await vault.depositorsMap(user), true);
      });
    });

    describe("#commitAndClose", () => {
      time.revertToSnapshotAfterEach();

      it("sets the next option and closes existing short", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await depositIntoVault(collateralAsset, vault, depositAmount);

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
        await approve(assetContract, vault, depositAmount, userSigner);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await vault.connect(ownerSigner).commitAndClose();

        await vault.connect(ownerSigner).commitAndClose();
      });

      it("sets the correct strike when overriding strike price", async function () {
        const newStrikePrice = manualStrikePrice;

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
          (
            await optionsPremiumPricer.getPremiumInStables(
              newStrikePrice,
              expiryTimestampOfNewOption,
              params.isPut
            )
          )
            .mul(await vault.premiumDiscount())
            .div(1000)
        );
      });

      it("closes short even when otokens are burned", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToNextOption();

        // we couldn't get any bids OTC, so we just burn the minted oTokens
        // and return 100% of the tokens

        await vault.connect(keeperSigner).burnRemainingOTokens();

        await rollToSecondOption(firstOption.strikePrice);

        const controller = await ethers.getContractAt(
          "IController",
          GAMMA_CONTROLLER[chainId]
        );

        assert.equal(await controller.getAccountVaultCounter(vault.address), 2);
      });

      it("closes short when otokens are partially burned", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToNextOption();

        const otoken = await ethers.getContractAt(
          "IERC20",
          firstOption.address
        );

        // Purchase half the oTokens
        const initialOtokenBalance = await otoken.balanceOf(vault.address);
        const totalOptionsAvailableToBuy = initialOtokenBalance.div(2);
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          totalOptionsAvailableToBuy.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: userSigner.address,
          signerPrivateKey: userSignerPrivateKey,
          sellToken: otoken.address,
          buyToken: premiumContract.address,
          sellAmount: totalOptionsAvailableToBuy.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(userSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        // since some oTokens sold, we distribute the premiums
        await vault.connect(keeperSigner).chargeAndDistribute();

        assert.bnEqual(
          await otoken.balanceOf(vault.address),
          initialOtokenBalance.div(2)
        );

        // burn remaining unused oTokens
        await vault.connect(keeperSigner).burnRemainingOTokens();

        await rollToSecondOption(firstOption.strikePrice);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await depositIntoVault(collateralAsset, vault, depositAmount);
        const res = await vault
          .connect(ownerSigner)
          .commitAndClose({ from: owner });

        const receipt = await res.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 1162951);
        // console.log("commitAndClose", receipt.gasUsed.toNumber());
      });
    });

    describe("#sellOptions", () => {
      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(params.collateralAsset, vault, depositAmount);

        if (params.collateralAsset === WETH_ADDRESS[chainId]) {
          const weth = assetContract.connect(userSigner);
          await weth.deposit({ value: depositAmount });
        }
        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT);

        await vault.connect(keeperSigner).rollToNextOption();
      });
      it("completes the trade with the counterparty", async function () {
        const otoken = await ethers.getContractAt(
          "IERC20",
          defaultOtoken.address
        );

        // Get all balances before swapping
        const vaultOtokenBalanceBefore = await otoken.balanceOf(vault.address);

        const vaultPremiumBalanceBefore = await premiumContract.balanceOf(
          vault.address
        );

        const userSignerOtokenBalanceBefore = await otoken.balanceOf(
          userSigner.address
        );

        const userSignerPremiumBalanceBefore = await premiumContract.balanceOf(
          userSigner.address
        );

        // Before swapping, assert balances are 0 for accurate checking after
        assert.bnEqual(vaultPremiumBalanceBefore, BigNumber.from(0));
        assert.bnEqual(userSignerOtokenBalanceBefore, BigNumber.from(0));

        // Create airswap order

        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          vaultOtokenBalanceBefore.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();
        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: userSigner.address,
          signerPrivateKey: userSignerPrivateKey,
          sellToken: otoken.address,
          buyToken: premiumContract.address,
          sellAmount: vaultOtokenBalanceBefore.toString(),
          buyAmount: bid,
        });

        // Approve airswap contract for oToken purchase
        await premiumContract
          .connect(userSigner)
          .approve(airswapContract.address, bid);

        // Sell oTokens
        const res = await vault.connect(keeperSigner).sellOptions(signedOrder);

        await expect(res).to.emit(airswapContract, "Swap");
        await expect(res)
          .to.emit(otoken, "Transfer")
          .withArgs(
            vault.address,
            userSigner.address,
            vaultOtokenBalanceBefore
          );
        await expect(res)
          .to.emit(premiumContract, "Transfer")
          .withArgs(userSigner.address, vault.address, bid);

        // Get all balances after swapping
        const vaultOtokenBalanceAfter = await otoken.balanceOf(vault.address);

        const vaultPremiumBalanceAfter = await premiumContract.balanceOf(
          vault.address
        );

        const userSignerOtokenBalanceAfter = await otoken.balanceOf(
          userSigner.address
        );

        const userSignerPremiumBalanceAfter = await premiumContract.balanceOf(
          userSigner.address
        );

        // Vault checks

        // All oTokens transferred out from vault, no oTokens left in vault
        assert.bnEqual(
          vaultOtokenBalanceBefore.sub(vaultOtokenBalanceAfter),
          vaultOtokenBalanceBefore
        );

        // Premium is transferred to vault
        assert.bnEqual(
          vaultPremiumBalanceAfter.sub(vaultPremiumBalanceBefore),
          BigNumber.from(bid)
        );

        // userSigner checks

        // oTokens are transferred to userSigner
        assert.bnEqual(
          userSignerOtokenBalanceAfter.sub(userSignerOtokenBalanceBefore),
          vaultOtokenBalanceBefore
        );

        // Premium is transferred out from userSigner
        assert.bnEqual(
          userSignerPremiumBalanceBefore.sub(userSignerPremiumBalanceAfter),
          BigNumber.from(bid)
        );

        // Check that currentOTokenPremium is set, truncating premium to 6 decimals
        // since USDC value
        assert.bnEqual(
          await vault.connect(userSigner).currentOtokenPremium(),
          firstOptionPremium.div(10 ** 12)
        );
      });
      it("reverts when sender is not vault", async function () {
        const otoken = await ethers.getContractAt(
          "IERC20",
          defaultOtoken.address
        );
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: keeperSigner.address, // To simulate non-vault address
          counterpartyAddress: userSigner.address,
          signerPrivateKey: userSignerPrivateKey,
          sellToken: otoken.address,
          buyToken: premiumContract.address,
          sellAmount: "10",
          buyAmount: "10",
        });

        await premiumContract
          .connect(userSigner)
          .approve(airswapContract.address, BigNumber.from(10));

        await expect(
          vault.connect(keeperSigner).sellOptions(signedOrder)
        ).to.be.revertedWith("Sender can only be vault");
      });
      it("reverts when not buying current oToken", async function () {
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: userSigner.address,
          signerPrivateKey: userSignerPrivateKey,
          sellToken: secondOption.address, // To simulate non-current option
          buyToken: premiumContract.address,
          sellAmount: "10",
          buyAmount: "10",
        });

        await premiumContract
          .connect(userSigner)
          .approve(airswapContract.address, BigNumber.from(10));

        await expect(
          vault.connect(keeperSigner).sellOptions(signedOrder)
        ).to.be.revertedWith("Can only sell currentOption");
      });
      it("reverts when not buying with USDC", async function () {
        const otoken = await ethers.getContractAt(
          "IERC20",
          defaultOtoken.address
        );
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: userSigner.address,
          signerPrivateKey: userSignerPrivateKey,
          sellToken: otoken.address,
          buyToken: assetContract.address, // To simulate non-USDC
          sellAmount: "10",
          buyAmount: "10",
        });

        await assetContract
          .connect(userSigner)
          .approve(airswapContract.address, BigNumber.from(10));

        await expect(
          vault.connect(keeperSigner).sellOptions(signedOrder)
        ).to.be.revertedWith("Can only buy with USDC");
      });
    });

    describe("#burnRemainingOTokens", () => {
      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(params.collateralAsset, vault, depositAmount);

        if (params.collateralAsset === WETH_ADDRESS[chainId]) {
          const weth = assetContract.connect(userSigner);
          await weth.deposit({ value: depositAmount });
          return;
        }
      });

      it("reverts when not called with keeper", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT);

        await vault.connect(keeperSigner).rollToNextOption();

        await expect(
          vault.connect(ownerSigner).burnRemainingOTokens()
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when trying to burn 0 OTokens", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT);

        await vault.connect(keeperSigner).rollToNextOption();

        const otoken = await ethers.getContractAt(
          "IERC20",
          defaultOtoken.address
        );

        // Purchase all the oTokens
        const initialOtokenBalance = await otoken.balanceOf(vault.address);
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          initialOtokenBalance.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: userSigner.address,
          signerPrivateKey: userSignerPrivateKey,
          sellToken: otoken.address,
          buyToken: premiumContract.address,
          sellAmount: initialOtokenBalance.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(userSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        await expect(
          vault.connect(keeperSigner).burnRemainingOTokens()
        ).to.be.revertedWith("No oTokens to burn");
      });

      it("burns all remaining oTokens when half oTokens leftover", async function () {
        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT);

        await vault.connect(keeperSigner).rollToNextOption();

        let tokenContract = premiumInStables ? premiumContract : assetContract;

        const otoken = await ethers.getContractAt(
          "IERC20",
          firstOption.address
        );

        // Purchase half the oTokens
        const initialOtokenBalance = await otoken.balanceOf(vault.address);
        const totalOptionsAvailableToBuy = initialOtokenBalance.div(2);
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          totalOptionsAvailableToBuy.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: userSigner.address,
          signerPrivateKey: userSignerPrivateKey,
          sellToken: otoken.address,
          buyToken: premiumContract.address,
          sellAmount: totalOptionsAvailableToBuy.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(userSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        const assetBalanceAfterSettle = await tokenContract.balanceOf(
          vault.address
        );
        const oldLockedAmount = (await vault.connect(ownerSigner).vaultState())
          .lockedAmount;

        vault.connect(keeperSigner).burnRemainingOTokens();
        const assetBalanceAfterBurn = await tokenContract.balanceOf(
          vault.address
        );

        // Assume premium is in stables, asset balance does not change
        assert.equal(
          parseInt(assetBalanceAfterBurn.toString()),
          parseInt(assetBalanceAfterSettle.toString())
        );

        const newLockedAmount = (await vault.connect(ownerSigner).vaultState())
          .lockedAmount;

        // New locked amount should be half old locked amount since half oTokens burnt and half sold
        assert.bnEqual(newLockedAmount, oldLockedAmount.div(2));
      });
    });

    describe("#rollToNextOption", () => {
      let oracle: Contract;
      const depositAmount = params.depositAmount;

      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(params.collateralAsset, vault, depositAmount);

        oracle = await setupOracle(
          params.asset,
          params.chainlinkPricer,
          ownerSigner,
          OPTION_PROTOCOL.GAMMA
        );
      });

      it("reverts when not called with keeper", async function () {
        await expect(
          vault.connect(ownerSigner).rollToNextOption()
        ).to.be.revertedWith("!keeper");
      });

      it("mints oTokens and deposits collateral into vault", async function () {
        const startMarginBalance = await assetContract.balanceOf(
          MARGIN_POOL[chainId]
        );

        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const res = await vault.connect(keeperSigner).rollToNextOption();

        await expect(res).to.not.emit(vault, "CloseShort");

        await expect(res)
          .to.emit(vault, "OpenShort")
          .withArgs(defaultOtokenAddress, depositAmount, keeper);

        const vaultState = await vault.vaultState();

        assert.equal(vaultState.lockedAmount.toString(), depositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );

        assert.equal(
          (await assetContract.balanceOf(MARGIN_POOL[chainId]))
            .sub(startMarginBalance)
            .toString(),
          depositAmount.toString()
        );

        assert.bnEqual(
          await defaultOtoken.allowance(
            vault.address,
            AIRSWAP_CONTRACT[chainId]
          ),
          params.expectedMintAmount
        );

        assert.equal(await vault.currentOption(), defaultOtokenAddress);
      });

      it("reverts when calling before expiry", async function () {
        // We have a newer version of Opyn deployed, error messages are different
        const EXPECTED_ERROR = {
          [CHAINID.ETH_MAINNET]: "C31",
          // "Controller: can not settle vault with un-expired otoken",
          [CHAINID.AVAX_MAINNET]: "C31",
          [CHAINID.AVAX_FUJI]: "C31",
        };

        const firstOptionAddress = firstOption.address;

        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount, keeper);

        // 100% of the vault's balance is allocated to short
        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );

        await expect(
          vault.connect(ownerSigner).commitAndClose()
        ).to.be.revertedWith(EXPECTED_ERROR[chainId]);
      });

      it("withdraws and roll funds into next option, after expiry ITM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        assert.equal(await vault.currentOption(), firstOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), firstOption.expiry);

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount, keeper);

        // We just settle the swap without any bids (do nothing)
        // So we simulate a loss when the options expire in the money

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(1)
          : firstOptionStrike.add(1);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceITM
        );

        const beforeBalance = await assetContract.balanceOf(vault.address);

        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

        const firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

        const afterBalance = await assetContract.balanceOf(vault.address);

        // test that the vault's balance decreased after closing short when ITM
        assert.isAbove(
          parseInt(depositAmount.toString()),
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

        const currBalance = await assetContract.balanceOf(vault.address);

        const secondTx = await vault.connect(keeperSigner).rollToNextOption();

        // assert.equal(await vault.currentOption(), secondOptionAddress);
        assert.equal(
          (await getCurrentOptionExpiry()).toString(),
          secondOption.expiry
        );

        const managementFeeInAsset = currBalance
          .mul(await vault.managementFee())
          .div(FEE_SCALING.mul(100));

        await expect(secondTx)
          .to.emit(vault, "OpenShort")
          .withArgs(
            secondOptionAddress,
            currBalance.sub(managementFeeInAsset),
            keeper
          );

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );
      });

      it("reverts when calling before expiry", async function () {
        // We have a newer version of Opyn deployed, error messages are different
        const EXPECTED_ERROR = {
          [CHAINID.ETH_MAINNET]: "C31",
          // "Controller: can not settle vault with un-expired otoken",
          [CHAINID.AVAX_MAINNET]: "C31",
          [CHAINID.AVAX_FUJI]: "C31",
        };

        const firstOptionAddress = firstOption.address;

        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount, keeper);

        // 100% of the vault's balance is allocated to short
        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );

        await expect(
          vault.connect(ownerSigner).commitAndClose()
        ).to.be.revertedWith(EXPECTED_ERROR[chainId]);
      });

      it("withdraws and roll funds into next option, after expiry OTM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount, keeper);

        let tokenContract = premiumInStables ? premiumContract : assetContract;

        // Purchase all the oTokens
        const initialOtokenBalance = await defaultOtoken.balanceOf(
          vault.address
        );
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          initialOtokenBalance.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: keeperSigner.address, // We simulate keeper as the option seller
          signerPrivateKey: keeperSignerPrivateKey,
          sellToken: defaultOtoken.address,
          buyToken: tokenContract.address,
          sellAmount: initialOtokenBalance.toString(),
          buyAmount: bid,
        });

        await tokenContract
          .connect(keeperSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        // Asset balance when swap completes only contains premium
        // Remaining vault's balance is still in Opyn Gamma Controller
        let swapProceeds = await tokenContract.balanceOf(vault.address);

        const settlementPriceOTM = isPut
          ? firstOptionStrike.add(1)
          : firstOptionStrike.sub(1);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceOTM
        );

        const beforeBalance = await assetContract.balanceOf(vault.address);

        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

        const firstCloseTx = await vault.connect(ownerSigner).commitAndClose();

        const afterBalance = await assetContract.balanceOf(vault.address);
        // test that the vault's balance does not change after closing short when OTM
        assert.equal(
          parseInt(depositAmount.toString()),
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

        const secondInitialTotalBalance = await vault.totalBalance();

        const secondTx = await vault.connect(keeperSigner).rollToNextOption();

        let vaultFees = secondInitialLockedBalance
          .add(queuedWithdrawAmount)
          .sub(pendingAmount)
          .mul(await vault.managementFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));

        const totalBalanceAfterFee = await vault.totalBalance();

        assert.equal(
          secondInitialTotalBalance.sub(totalBalanceAfterFee).toString(),
          vaultFees.toString()
        );

        assert.equal(await vault.currentOption(), secondOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);

        await expect(secondTx)
          .to.emit(vault, "OpenShort")
          .withArgs(
            secondOptionAddress,
            depositAmount
              .add(premiumInStables ? 0 : swapProceeds)
              .sub(vaultFees),
            keeper
          );

        assert.equal(
          (await assetContract.balanceOf(vault.address)).toString(),
          BigNumber.from(0)
        );
      });

      it("withdraws and roll funds into next option, after expiry OTM (initiateWithdraw)", async function () {
        const withdrawAmount = 100000000;

        await depositIntoVault(
          params.collateralAsset,
          vault,
          depositAmount.mul(2),
          ownerSigner
        );

        await depositIntoVault(
          params.collateralAsset,
          vault,
          depositAmount,
          userSigner
        );

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).rollToNextOption();
        await vault.connect(ownerSigner).initiateWithdraw(withdrawAmount);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          firstOptionStrike
        );

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).rollToNextOption();

        let [, queuedWithdrawAmountInitial] = await lockedBalanceForRollover(
          vault
        );

        let tokenContract = premiumInStables ? premiumContract : assetContract;

        const currOTokenContract = await getContractAt(
          "IERC20",
          await vault.currentOption()
        );

        // Purchase all the oTokens
        const initialOtokenBalance = await currOTokenContract.balanceOf(
          vault.address
        );
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          initialOtokenBalance.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: keeperSigner.address, // We simulate keeper as the option seller
          signerPrivateKey: keeperSignerPrivateKey,
          sellToken: await vault.currentOption(),
          buyToken: tokenContract.address,
          sellAmount: initialOtokenBalance.toString(),
          buyAmount: bid,
        });

        await tokenContract
          .connect(keeperSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        let newOptionStrike = await (
          await getContractAt("IOtoken", await vault.currentOption())
        ).strikePrice();
        const settlementPriceOTM = isPut
          ? newOptionStrike.add(1)
          : newOptionStrike.sub(1);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceOTM
        );

        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

        await vault.initiateWithdraw(withdrawAmount);

        await vault.connect(ownerSigner).commitAndClose();

        // Time increase to after next option available
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        let pendingAmount = (await vault.vaultState()).totalPending;
        let [secondInitialLockedBalance, queuedWithdrawAmount] =
          await lockedBalanceForRollover(vault);

        const secondInitialBalance = await vault.totalBalance();

        await vault.connect(keeperSigner).rollToNextOption();

        let vaultFees = secondInitialLockedBalance
          .add(queuedWithdrawAmount.sub(queuedWithdrawAmountInitial))
          .sub(pendingAmount)
          .mul(await vault.managementFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));

        assert.equal(
          secondInitialBalance.sub(await vault.totalBalance()).toString(),
          vaultFees.toString()
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

      it("does not debit the user on first deposit", async () => {
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        // totalBalance should remain the same before and after roll
        const startBalance = await vault.totalBalance();

        await vault.connect(keeperSigner).rollToNextOption();

        assert.bnEqual(await vault.totalBalance(), startBalance);
        assert.bnEqual(await vault.accountVaultBalance(user), depositAmount);

        // simulate a profit by transferring some tokens
        await assetContract
          .connect(userSigner)
          .transfer(vault.address, BigNumber.from(1));

        // totalBalance should remain the same before and after roll
        const secondStartBalance = await vault.totalBalance();

        await rollToSecondOption(firstOptionStrike);

        // After the first round, the user is charged the fee
        assert.bnLte(await vault.totalBalance(), secondStartBalance);
        assert.bnGte(await vault.accountVaultBalance(user), depositAmount);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const tx = await vault.connect(keeperSigner).rollToNextOption();
        const receipt = await tx.wait();

        assert.isAtMost(receipt.gasUsed.toNumber(), 1012269);
        // console.log("rollToNextOption", receipt.gasUsed.toNumber());
      });
    });

    describe("#assetBalance", () => {
      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(
          params.collateralAsset,
          vault,
          params.depositAmount
        );

        await rollToNextOption();
      });

      it("returns the free balance - locked, if free > locked", async function () {
        const newDepositAmount = BigNumber.from("1000000000000");
        await depositIntoVault(params.collateralAsset, vault, newDepositAmount);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          newDepositAmount
        );
      });
    });

    describe("#maxRedeem", () => {
      let oracle: Contract;

      time.revertToSnapshotAfterEach(async function () {
        oracle = await setupOracle(
          params.asset,
          params.chainlinkPricer,
          ownerSigner,
          OPTION_PROTOCOL.GAMMA
        );
      });

      it("is able to redeem deposit at new price per share", async function () {
        await approve(assetContract, vault, params.depositAmount, userSigner);

        await vault.deposit(params.depositAmount);

        await rollToNextOption();

        const tx = await vault.maxRedeem();

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
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

      it("changes balance only once when redeeming twice", async function () {
        await approve(assetContract, vault, params.depositAmount, userSigner);

        await vault.deposit(params.depositAmount);

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
        await approve(
          assetContract,
          vault,
          params.depositAmount.mul(2),
          userSigner
        );
        await vault.deposit(params.depositAmount);
        await rollToNextOption();

        await vault.deposit(params.depositAmount);

        const tx = await vault.maxRedeem();

        await expect(tx)
          .to.emit(vault, "Redeem")
          .withArgs(user, params.depositAmount, 2);
      });

      it("is able to redeem deposit at correct pricePerShare after closing short in the money", async function () {
        await approve(assetContract, vault, params.depositAmount, userSigner);

        await approve(assetContract, vault, params.depositAmount, ownerSigner);
        // Mid-week deposit in round 1
        await assetContract
          .connect(userSigner)
          .transfer(owner, params.depositAmount);
        await vault.connect(ownerSigner).deposit(params.depositAmount);

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).rollToNextOption();

        // Mid-week deposit in round 2
        await vault.connect(userSigner).deposit(params.depositAmount);

        const vaultState = await vault.vaultState();

        const beforeBalance = (
          await assetContract.balanceOf(vault.address)
        ).add(vaultState.lockedAmount);

        const beforePps = await vault.pricePerShare();

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(100000000000)
          : firstOptionStrike.add(100000000000);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceITM
        );

        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).rollToNextOption();

        const afterBalance = await assetContract.balanceOf(vault.address);
        const afterPps = await vault.pricePerShare();
        const expectedMintAmountAfterLoss = params.depositAmount
          .mul(BigNumber.from(10).pow(params.tokenDecimals))
          .div(afterPps);

        assert.bnGt(beforeBalance, afterBalance);
        assert.bnGt(beforePps, afterPps);

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
      time.revertToSnapshotAfterEach();

      it("reverts when 0 passed", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);

        await vault.deposit(depositAmount);
        await rollToNextOption();
        await expect(vault.redeem(0)).to.be.revertedWith("!numShares");
      });

      it("reverts when redeeming more than available", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await expect(vault.redeem(depositAmount.add(1))).to.be.revertedWith(
          "Exceeds available"
        );
      });

      it("decreases unredeemed shares", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
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
      time.revertToSnapshotAfterEach();

      it("reverts with 0 amount", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await expect(vault.withdrawInstantly(0)).to.be.revertedWith("!amount");
      });

      it("reverts when withdrawing more than available", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await expect(
          vault.withdrawInstantly(depositAmount.add(1))
        ).to.be.revertedWith("Exceed amount");
      });

      it("reverts when deposit receipt is processed", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await vault.maxRedeem();

        await expect(
          vault.withdrawInstantly(depositAmount.add(1))
        ).to.be.revertedWith("Invalid round");
      });

      it("reverts when withdrawing next round", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await expect(
          vault.withdrawInstantly(depositAmount.add(1))
        ).to.be.revertedWith("Invalid round");
      });

      it("reverts when causing total deposit to go down below minimum", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        const withdrawAmount = depositAmount.sub(parseEther("0.5"));

        await expect(
          vault.withdrawInstantly(withdrawAmount)
        ).to.be.revertedWith("Minimum deposit not reached");
      });

      it("withdraws the amount in deposit receipt", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
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

      it("removes user from list if all deposit amount is withdrawn", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);

        await approve(assetContract, vault, depositAmount, ownerSigner);

        await vault.connect(ownerSigner).deposit(depositAmount);
        await vault.connect(userSigner).deposit(depositAmount);
        await vault.connect(userSigner).withdrawInstantly(depositAmount.div(2));

        assert.equal(await vault.depositorsArray(0), owner);
        assert.equal(await vault.depositorsMap(owner), true);

        assert.equal(await vault.depositorsArray(1), user);
        assert.equal(await vault.depositorsMap(user), true);

        await vault.connect(userSigner).withdrawInstantly(depositAmount.div(2));

        await expect(vault.depositorsArray(1)).to.be.reverted;
        assert.equal(await vault.depositorsMap(user), false);
      });
    });

    describe("#initiateWithdraw", () => {
      let oracle: Contract;

      time.revertToSnapshotAfterEach(async () => {
        oracle = await setupOracle(
          params.asset,
          params.chainlinkPricer,
          ownerSigner,
          OPTION_PROTOCOL.GAMMA
        );
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
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        await expect(
          vault.initiateWithdraw(depositAmount.add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when withdrawing more than vault + account balance", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        // Move 1 share into account
        await vault.redeem(1);

        await expect(
          vault.initiateWithdraw(depositAmount.add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when initiating with past existing withdrawal", async function () {
        const withdrawAmount = 100000000;
        await approve(
          assetContract,
          vault,
          depositAmount.add(withdrawAmount),
          userSigner
        );
        await vault.deposit(depositAmount.add(withdrawAmount));

        await rollToNextOption();

        await vault.initiateWithdraw(withdrawAmount);

        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          firstOptionStrike
        );
        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).rollToNextOption();

        await expect(vault.initiateWithdraw(withdrawAmount)).to.be.revertedWith(
          "Existing withdraw"
        );
      });

      it("creates withdrawal from unredeemed shares", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
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
        await approve(assetContract, vault, depositAmount, userSigner);
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
        const firstWithdrawAmount = 100000000;
        const secondWithdrawAmount = 200000000;
        const totalDeposit = depositAmount
          .add(firstWithdrawAmount)
          .add(secondWithdrawAmount);

        await approve(assetContract, vault, totalDeposit, userSigner);
        await vault.deposit(totalDeposit);

        await rollToNextOption();

        const tx1 = await vault.initiateWithdraw(firstWithdrawAmount);
        // We redeem the full amount on the first initiateWithdraw
        await expect(tx1)
          .to.emit(vault, "Transfer")
          .withArgs(vault.address, user, totalDeposit);
        await expect(tx1)
          .to.emit(vault, "Transfer")
          .withArgs(user, vault.address, firstWithdrawAmount);

        const tx2 = await vault.initiateWithdraw(secondWithdrawAmount);
        await expect(tx2)
          .to.emit(vault, "Transfer")
          .withArgs(user, vault.address, secondWithdrawAmount);

        const { round, shares } = await vault.withdrawals(user);
        assert.equal(round, 2);
        assert.bnEqual(
          shares,
          BigNumber.from(firstWithdrawAmount).add(secondWithdrawAmount)
        );
      });
      it("reverts when there is insufficient balance over multiple calls", async function () {
        const withdrawAmount = BigNumber.from(100000000);

        await approve(
          assetContract,
          vault,
          depositAmount.add(withdrawAmount),
          userSigner
        );

        await vault.deposit(depositAmount.add(withdrawAmount));

        await rollToNextOption();

        await vault.initiateWithdraw(withdrawAmount);

        await expect(
          vault.initiateWithdraw(depositAmount.add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("allows withdrawal if taking out full balance", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const tx1 = await vault.initiateWithdraw(depositAmount);

        await expect(tx1)
          .to.emit(vault, "Transfer")
          .withArgs(user, vault.address, depositAmount);
      });

      it("removes user from list if initiating full amount withdraw", async function () {
        // Assume user is initiating withdraw twice which amounts to full amount
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const tx1 = await vault.initiateWithdraw(depositAmount.div(3));

        await expect(tx1)
          .to.emit(vault, "Transfer")
          .withArgs(user, vault.address, depositAmount.div(3));

        assert.equal(await vault.depositorsArray(0), user);
        assert.equal(await vault.depositorsMap(user), true);

        const tx2 = await vault.initiateWithdraw(
          depositAmount.sub(depositAmount.div(3))
        );

        await expect(tx2)
          .to.emit(vault, "Transfer")
          .withArgs(
            user,
            vault.address,
            depositAmount.sub(depositAmount.div(3))
          );

        await expect(vault.depositorsArray(0)).to.be.reverted;
        assert.equal(await vault.depositorsMap(user), false);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        const tx = await vault.initiateWithdraw(depositAmount);
        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 140000);
        // console.log("initiateWithdraw", receipt.gasUsed.toNumber());
      });
    });

    describe("#completeWithdraw", () => {
      time.revertToSnapshotAfterEach(async () => {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await approve(assetContract, vault, depositAmount, ownerSigner);
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
        const lastQueuedWithdrawAmount = await vault.lastQueuedWithdrawAmount();

        let beforeBalance: BigNumber;
        if (collateralAsset === WETH_ADDRESS[chainId]) {
          beforeBalance = await provider.getBalance(user);
        } else {
          beforeBalance = await assetContract.balanceOf(user);
        }

        const { queuedWithdrawShares: startQueuedShares } =
          await vault.vaultState();

        const tx = await vault.completeWithdraw({ gasPrice });
        const receipt = await tx.wait();
        const gasFee = receipt.gasUsed.mul(gasPrice);

        await expect(tx)
          .to.emit(vault, "Withdraw")
          .withArgs(user, withdrawAmount.toString(), depositAmount);

        if (collateralAsset !== WETH_ADDRESS[chainId]) {
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

        const { queuedWithdrawShares: endQueuedShares } =
          await vault.vaultState();

        assert.bnEqual(endQueuedShares, BigNumber.from(0));
        assert.bnEqual(
          await vault.lastQueuedWithdrawAmount(),
          lastQueuedWithdrawAmount.sub(withdrawAmount)
        );
        assert.bnEqual(startQueuedShares.sub(endQueuedShares), depositAmount);

        let actualWithdrawAmount: BigNumber;
        if (collateralAsset === WETH_ADDRESS[chainId]) {
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

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await rollToSecondOption(firstOption.strikePrice);

        const tx = await vault.completeWithdraw({ gasPrice });
        const receipt = await tx.wait();

        assert.isAtMost(receipt.gasUsed.toNumber(), 151803);
        // console.log(
        //   params.name,
        //   "completeWithdraw",
        //   receipt.gasUsed.toNumber()
        // );
      });
    });

    describe("#chargeAndDistribute", () => {
      let oracle: Contract;
      const depositAmount = params.depositAmount;

      time.revertToSnapshotAfterEach(async function () {
        await depositIntoVault(
          params.collateralAsset,
          vault,
          depositAmount,
          userSigner
        );
        await depositIntoVault(
          params.collateralAsset,
          vault,
          depositAmount.mul(2),
          ownerSigner
        );

        oracle = await setupOracle(
          params.asset,
          params.chainlinkPricer,
          ownerSigner,
          OPTION_PROTOCOL.GAMMA
        );
      });

      it("reverts when not called with keeper", async function () {
        await expect(
          vault.connect(ownerSigner).chargeAndDistribute()
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when there is no premium to distribute", async function () {
        await expect(
          vault.connect(keeperSigner).chargeAndDistribute()
        ).to.be.revertedWith("no premium to distribute");
      });

      it("distributes to users according to share amount and collects correct fees", async function () {
        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(defaultOtokenAddress, depositAmount.mul(3), keeper);

        // Purchase all the oTokens
        const initialOtokenBalance = await defaultOtoken.balanceOf(
          vault.address
        );
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          initialOtokenBalance.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: keeperSigner.address, // We simulate keeper as the option seller
          signerPrivateKey: keeperSignerPrivateKey,
          sellToken: defaultOtoken.address,
          buyToken: premiumContract.address,
          sellAmount: initialOtokenBalance.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(keeperSigner)
          .approve(airswapContract.address, bid);

        let userBalanceBefore = await premiumContract.balanceOf(user);
        let ownerBalanceBefore = await premiumContract.balanceOf(owner);
        let feeRecipientBalanceBefore = await premiumContract.balanceOf(
          feeRecipient
        );

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        let tx = await vault.connect(keeperSigner).chargeAndDistribute();

        let userBalanceAfter = await premiumContract.balanceOf(user);
        let ownerBalanceAfter = await premiumContract.balanceOf(owner);
        let feeRecipientBalanceAfter = await premiumContract.balanceOf(
          feeRecipient
        );

        let performanceFeeInAsset = BigNumber.from(bid)
          .mul(performanceFee)
          .div(FEE_SCALING.mul(100));
        let totalDistributed = BigNumber.from(bid).sub(performanceFeeInAsset);

        assert.bnEqual(
          userBalanceAfter.sub(userBalanceBefore),
          totalDistributed.div(3)
        );

        assert.bnEqual(
          ownerBalanceAfter.sub(ownerBalanceBefore),
          totalDistributed.mul(2).div(3)
        );

        assert.bnEqual(
          feeRecipientBalanceAfter.sub(feeRecipientBalanceBefore),
          performanceFeeInAsset
        );

        await expect(tx)
          .to.emit(vault, "CollectPerformanceFee")
          .withArgs(performanceFeeInAsset, 1, feeRecipient);

        await expect(tx)
          .to.emit(vault, "DistributePremium")
          .withArgs(
            totalDistributed,
            [totalDistributed.div(3), totalDistributed.mul(2).div(3)],
            [user, owner],
            1
          );
      });

      it("does not distribute to users who withdraw", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount.mul(3), keeper);

        // Purchase all the oTokens
        const initialOtokenBalance = await defaultOtoken.balanceOf(
          vault.address
        );
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          initialOtokenBalance.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrderOne = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: keeperSigner.address, // We simulate keeper as the option seller
          signerPrivateKey: keeperSignerPrivateKey,
          sellToken: defaultOtoken.address,
          buyToken: premiumContract.address,
          sellAmount: initialOtokenBalance.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(keeperSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrderOne);

        let userBalanceBefore = await premiumContract.balanceOf(user);
        let ownerBalanceBefore = await premiumContract.balanceOf(owner);

        let tx = await vault.connect(keeperSigner).chargeAndDistribute();

        const settlementPriceOTM = isPut
          ? firstOptionStrike.add(1)
          : firstOptionStrike.sub(1);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceOTM
        );

        let userBalanceAfter = await premiumContract.balanceOf(user);
        let ownerBalanceAfter = await premiumContract.balanceOf(owner);

        let performanceFeeInAsset = BigNumber.from(bid)
          .mul(performanceFee)
          .div(FEE_SCALING.mul(100));
        let totalDistributed = BigNumber.from(bid).sub(performanceFeeInAsset);

        assert.bnEqual(
          userBalanceAfter.sub(userBalanceBefore),
          totalDistributed.div(3)
        );
        assert.bnEqual(
          ownerBalanceAfter.sub(ownerBalanceBefore),
          totalDistributed.mul(2).div(3)
        );

        await expect(tx)
          .to.emit(vault, "DistributePremium")
          .withArgs(
            totalDistributed,
            [totalDistributed.div(3), totalDistributed.mul(2).div(3)],
            [user, owner],
            1
          );

        const userShares = await vault.shares(user);
        await vault.connect(userSigner).initiateWithdraw(userShares);

        await vault.connect(ownerSigner).commitAndClose();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const secondTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(secondTx)
          .to.emit(vault, "OpenShort")
          .withArgs(secondOptionAddress, depositAmount.mul(2), keeper);

        const secondOptionContract = await getContractAt(
          "IERC20",
          secondOption.address
        );

        // Purchase all the oTokens
        const secondOptionInitialOTokenBalance =
          await secondOptionContract.balanceOf(vault.address);

        // Assume premium is in stables
        const signedOrderTwo = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: keeperSigner.address, // We simulate keeper as the option seller
          signerPrivateKey: keeperSignerPrivateKey,
          sellToken: secondOption.address,
          buyToken: premiumContract.address,
          sellAmount: secondOptionInitialOTokenBalance.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(keeperSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrderTwo);

        userBalanceBefore = await premiumContract.balanceOf(user);
        ownerBalanceBefore = await premiumContract.balanceOf(owner);

        tx = await vault.connect(keeperSigner).chargeAndDistribute();

        performanceFeeInAsset = BigNumber.from(bid)
          .mul(performanceFee)
          .div(FEE_SCALING.mul(100));
        totalDistributed = BigNumber.from(bid).sub(performanceFeeInAsset);

        // Leftover 1 due to rounding gets distributed in second round instead
        if (asset === BAL_ADDRESS[chainId]) {
          totalDistributed = totalDistributed.add(1);
        }

        userBalanceAfter = await premiumContract.balanceOf(user);
        ownerBalanceAfter = await premiumContract.balanceOf(owner);

        assert.bnEqual(
          userBalanceAfter.sub(userBalanceBefore),
          BigNumber.from(0)
        );
        assert.bnEqual(
          ownerBalanceAfter.sub(ownerBalanceBefore),
          totalDistributed
        );

        await expect(tx)
          .to.emit(vault, "DistributePremium")
          .withArgs(totalDistributed, [totalDistributed], [owner], 2);
      });

      it("called by commit and close when not triggered in the previous round", async function () {
        const firstOptionAddress = firstOption.address;

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).rollToNextOption();

        // Purchase all the oTokens
        const initialOtokenBalance = await defaultOtoken.balanceOf(
          vault.address
        );
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;
        const bid = wmul(
          initialOtokenBalance.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: keeperSigner.address, // We simulate keeper as the option seller
          signerPrivateKey: keeperSignerPrivateKey,
          sellToken: defaultOtoken.address,
          buyToken: premiumContract.address,
          sellAmount: initialOtokenBalance.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(keeperSigner)
          .approve(airswapContract.address, bid);

        let performanceFeeInAsset = BigNumber.from(bid)
          .mul(performanceFee)
          .div(FEE_SCALING.mul(100));

        assert.equal(await vault.currentOption(), firstOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), firstOption.expiry);

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          asset,
          oracle,
          await getCurrentOptionExpiry(),
          firstOptionStrike
        );

        const tx = await vault.connect(ownerSigner).commitAndClose();

        expect(tx)
          .to.emit(vault, "CollectPerformanceFee")
          .withArgs(performanceFeeInAsset, 1, feeRecipient);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        const firstOptionAddress = firstOption.address;

        await vault.connect(ownerSigner).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount.mul(3), keeper);

        const initialOtokenBalance = await defaultOtoken.balanceOf(
          vault.address
        );
        let decimals = premiumInStables ? premiumDecimals : tokenDecimals;

        const bid = wmul(
          initialOtokenBalance.mul(BigNumber.from(10).pow(10)),
          firstOptionPremium
        )
          .div(BigNumber.from(10).pow(18 - decimals))
          .toString();

        // Assume premium is in stables
        const signedOrder = await signOrderForAirSwap({
          vaultAddress: vault.address,
          counterpartyAddress: keeperSigner.address, // We simulate keeper as the option seller
          signerPrivateKey: keeperSignerPrivateKey,
          sellToken: defaultOtoken.address,
          buyToken: premiumContract.address,
          sellAmount: initialOtokenBalance.toString(),
          buyAmount: bid,
        });

        await premiumContract
          .connect(keeperSigner)
          .approve(airswapContract.address, bid);

        await vault.connect(keeperSigner).sellOptions(signedOrder);

        let tx = await vault.connect(keeperSigner).chargeAndDistribute();

        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 210000);
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
          .withArgs(parseEther("2000000"), parseEther("10"));
      });

      it("should revert when depositing over the cap", async function () {
        const capAmount = BigNumber.from("100000000");
        const depositAmount = BigNumber.from("10000000000");
        await vault.connect(ownerSigner).setCap(capAmount);

        // Provide some WETH to the account
        if (params.collateralAsset === WETH_ADDRESS[chainId]) {
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
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        assert.bnEqual(await vault.shares(user), depositAmount);

        const redeemAmount = BigNumber.from(1);
        await vault.redeem(redeemAmount);

        // Share balance should remain the same because the 1 share
        // is transferred to the user
        assert.bnEqual(await vault.shares(user), depositAmount);
      });
    });

    describe("#shareBalances", () => {
      time.revertToSnapshotAfterEach();

      it("returns the share balances split", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

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
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

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
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        assert.bnEqual(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await approve(assetContract, vault, depositAmount, ownerSigner);
        await vault.connect(ownerSigner).deposit(depositAmount);

        // remain the same after deposit
        assert.bnEqual(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(100000000000)
          : firstOptionStrike.add(100000000000);

        // console.log(settlementPriceITM.toString());

        await rollToSecondOption(settlementPriceITM);

        // Minus 1 due to rounding errors from share price != 1
        assert.bnLt(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );
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

    describe("#transfer", () => {
      time.revertToSnapshotAfterEach();

      it("reverts on transfer", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);
        await vault.deposit(depositAmount);

        await rollToNextOption();

        assert.bnEqual(await vault.shares(user), depositAmount);

        const redeemAmount = BigNumber.from(1);
        await vault.redeem(redeemAmount);

        // Share balance should remain the same because the 1 share
        // is transferred to the user
        assert.bnEqual(await vault.shares(user), depositAmount);

        await expect(vault.transfer(owner, redeemAmount)).to.be.revertedWith(
          "Treasury rToken is not transferrable"
        );
      });
    });

    describe("#transferFrom", () => {
      time.revertToSnapshotAfterEach();

      it("reverts on transfer", async function () {
        await approve(assetContract, vault, depositAmount, userSigner);

        await vault.deposit(depositAmount);

        await rollToNextOption();

        assert.bnEqual(await vault.shares(user), depositAmount);

        const redeemAmount = BigNumber.from(1);
        await vault.redeem(redeemAmount);

        // Share balance should remain the same because the 1 share
        // is transferred to the user
        assert.bnEqual(await vault.shares(user), depositAmount);

        await expect(
          vault.transferFrom(user, owner, redeemAmount)
        ).to.be.revertedWith("Treasury rToken is not transferrable");
      });
    });
  });
}

async function depositIntoVault(
  asset: string,
  vault: Contract,
  amount: BigNumberish,
  signer?: SignerWithAddress
) {
  if (typeof signer !== "undefined") {
    vault = vault.connect(signer);
  }
  if (asset === WETH_ADDRESS[chainId]) {
    await vault.depositETH({ value: amount });
  } else {
    await vault.deposit(amount);
  }
}

async function approve(
  assetContract: Contract,
  vault: Contract,
  amount: BigNumberish,
  signer?: SignerWithAddress
) {
  if (assetContract.address === BADGER_ADDRESS[chainId]) {
    await assetContract.connect(signer).approve(vault.address, 0);
  }

  await assetContract.connect(signer).approve(vault.address, amount);
}
