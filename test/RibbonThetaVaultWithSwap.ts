import { ethers, network } from "hardhat";
import { expect } from "chai";
import { BigNumber, BigNumberish, constants, Contract } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import ManualVolOracle_ABI from "../constants/abis/ManualVolOracle.json";
import OptionsPremiumPricerInStables_ABI from "../constants/abis/OptionsPremiumPricerInStables.json";
import moment from "moment-timezone";
import * as time from "./helpers/time";
import {
  CHAINLINK_WBTC_PRICER,
  CHAINID,
  OPTION_PROTOCOL,
  BLOCK_NUMBER,
  ETH_PRICE_ORACLE,
  BTC_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  USDC_ADDRESS,
  WBTC_ADDRESS,
  WBTC_OWNER_ADDRESS,
  WETH_ADDRESS,
  ManualVolOracle_BYTECODE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../constants/constants";
import {
  deployProxy,
  setupOracle,
  setOpynOracleExpiryPrice,
  whitelistProduct,
  mintToken,
  Bid,
  generateSignedBid,
  lockedBalanceForRollover,
  getDeltaStep,
  getProtocolAddresses,
} from "./helpers/utils";
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

describe("RibbonThetaVaultWithSwap", () => {
  behavesLikeRibbonOptionsVault({
    name: `Ribbon WBTC Theta Vault (Call)`,
    tokenName: "Ribbon BTC Theta Vault",
    tokenSymbol: "rWBTC-THETA",
    asset: WBTC_ADDRESS[chainId],
    assetContractName:
      chainId === CHAINID.AVAX_MAINNET ? "IBridgeToken" : "IWBTC",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: WBTC_ADDRESS[chainId],
    chainlinkPricer: CHAINLINK_WBTC_PRICER[chainId],
    deltaFirstOption: BigNumber.from("1000"),
    deltaSecondOption: BigNumber.from("1000"),
    deltaStep: getDeltaStep("WBTC"),
    tokenDecimals: 8,
    depositAmount: BigNumber.from("100000000"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("2000000"),
    performanceFee: BigNumber.from("20000000"),
    minimumSupply: BigNumber.from("10").pow("3").toString(),
    expectedMintAmount: BigNumber.from("100000000"),
    isPut: false,
    gasLimits: {
      depositWorstCase: 101500,
      depositBestCase: 90000,
    },
    mintConfig: {
      amount: parseEther("200"),
      contractOwnerAddress: WBTC_OWNER_ADDRESS[chainId],
    },
    availableChains: [CHAINID.ETH_MAINNET],
    protocol: OPTION_PROTOCOL.GAMMA,
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
 * @param {BigNumber} params.expectedMintAmount - Expected oToken amount to be minted with our deposit
 * @param {BigNumber} params.premiumDiscount - Premium discount of the sold options to incentivize arbitraguers (thousandths place: 000 - 999)
 * @param {BigNumber} params.managementFee - Management fee (6 decimals)
 * @param {BigNumber} params.performanceFee - PerformanceFee fee (6 decimals)
 * @param {boolean} params.isPut - Boolean flag for if the vault sells call or put options
 * @param {number[]} params.availableChains - ChainIds where the tests for the vault will be executed
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
  isPut: boolean;
  gasLimits: {
    depositWorstCase: number;
    depositBestCase: number;
  };
  mintConfig?: {
    amount: BigNumber;
    contractOwnerAddress: string;
  };
  availableChains: number[];
  protocol: OPTION_PROTOCOL;
}) {
  // Test configs
  let availableChains = params.availableChains;

  // Skip test when vault is not available in the current chain
  if (!availableChains.includes(chainId)) {
    return;
  }

  const [GAMMA_CONTROLLER, OTOKEN_FACTORY, MARGIN_POOL] = getProtocolAddresses(
    params.protocol,
    chainId
  );

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
  let collateralAsset = params.collateralAsset;
  let depositAmount = params.depositAmount;
  let premiumDiscount = params.premiumDiscount;
  let managementFee = params.managementFee;
  let performanceFee = params.performanceFee;
  // let expectedMintAmount = params.expectedMintAmount;
  let isPut = params.isPut;

  // Contracts
  let strikeSelection: Contract;
  let volOracle: Contract;
  let optionsPremiumPricer: Contract;
  let swapContract: Contract;
  let vaultLifecycleLib: Contract;
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
  let startMarginBalance: BigNumber;
  let optionId: string;

  describe(`${params.name}`, () => {
    let initSnapshotId: string;
    let firstOption: Option;
    let secondOption: Option;

    const rollToFirstOption = async () => {
      await vault.connect(ownerSigner).closeRound();
      await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT);
      await strikeSelection.setDelta(params.deltaFirstOption);
      await vault.connect(keeperSigner).setMinPrice(parseEther("0.00551538"));
      await vault.connect(keeperSigner).commitNextOption();
      await vault.connect(keeperSigner).rollToNextOption();
    };

    const rollToSecondOption = async (settlementPrice: BigNumber) => {
      const oracle = await setupOracle(
        params.asset,
        params.chainlinkPricer,
        ownerSigner,
        params.protocol
      );

      await setOpynOracleExpiryPrice(
        params.asset,
        oracle,
        await getCurrentOptionExpiry(),
        settlementPrice
      );
      await strikeSelection.setDelta(params.deltaSecondOption);
      await vault.connect(ownerSigner).closeRound();
      await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
      await vault.connect(keeperSigner).setMinPrice(parseEther("30"));
      await vault.connect(keeperSigner).commitNextOption();
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

      await volOracle.setAnnualizedVol([optionId], [106480000]);

      const topOfPeriod = (await time.getTopOfPeriod()) + time.PERIOD;
      await time.increaseTo(topOfPeriod);

      const OptionsPremiumPricer = await getContractFactory(
        OptionsPremiumPricerInStables_ABI,
        OptionsPremiumPricerInStables_BYTECODE,
        ownerSigner
      );

      const StrikeSelection = await getContractFactory(
        "DeltaStrikeSelection",
        ownerSigner
      );

      optionsPremiumPricer = await OptionsPremiumPricer.deploy(
        optionId,
        volOracle.address,
        params.asset === WETH_ADDRESS[chainId]
          ? ETH_PRICE_ORACLE[chainId]
          : BTC_PRICE_ORACLE[chainId],
        USDC_PRICE_ORACLE[chainId]
      );

      strikeSelection = await StrikeSelection.deploy(
        optionsPremiumPricer.address,
        params.deltaFirstOption,
        BigNumber.from(params.deltaStep).mul(10 ** 8)
      );

      const VaultLifecycle = await ethers.getContractFactory(
        "VaultLifecycleWithSwap"
      );
      vaultLifecycleLib = await VaultLifecycle.deploy();

      const SwapContract = await getContractFactory("Swap", ownerSigner);

      swapContract = await SwapContract.deploy();

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
        ],
        [
          isPut,
          tokenDecimals,
          isPut ? USDC_ADDRESS[chainId] : asset,
          asset,
          minimumSupply,
          parseUnits("500", tokenDecimals > 18 ? tokenDecimals : 18),
        ],
      ];

      const deployArgs = [
        WETH_ADDRESS[chainId],
        USDC_ADDRESS[chainId],
        OTOKEN_FACTORY,
        GAMMA_CONTROLLER,
        MARGIN_POOL,
        swapContract.address,
      ];

      vault = (
        await deployProxy(
          "RibbonThetaVaultWithSwap",
          adminSigner,
          initializeArgs,
          deployArgs,
          {
            libraries: {
              VaultLifecycleWithSwap: vaultLifecycleLib.address,
            },
          }
        )
      ).connect(userSigner);

      oTokenFactory = await getContractAt("IOtokenFactory", OTOKEN_FACTORY);

      await whitelistProduct(
        params.asset,
        params.strikeAsset,
        params.collateralAsset,
        params.isPut,
        params.protocol
      );

      const latestTimestamp = (await provider.getBlock("latest")).timestamp;

      // Create first option
      firstOptionExpiry = moment(latestTimestamp * 1000)
        .startOf("isoWeek")
        .add(chainId === CHAINID.AVAX_MAINNET ? 0 : 1, "weeks")
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
        .add(chainId === CHAINID.AVAX_MAINNET ? 1 : 2, "weeks")
        .day("friday")
        .hours(8)
        .minutes(0)
        .seconds(0)
        .unix();

      // Create second option
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
        collateralAsset
      );

      startMarginBalance = await assetContract.balanceOf(MARGIN_POOL);

      // If mintable token, then mine the token
      if (params.mintConfig) {
        const addressToDeposit = [userSigner, ownerSigner, adminSigner];
        for (let i = 0; i < addressToDeposit.length; i++) {
          await mintToken(
            assetContract,
            params.mintConfig.contractOwnerAddress,
            addressToDeposit[i].address,
            vault.address,
            params.mintConfig.amount
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
          "RibbonThetaVaultWithSwap",
          {
            libraries: {
              VaultLifecycleWithSwap: vaultLifecycleLib.address,
            },
          }
        );
        testVault = await RibbonThetaVault.deploy(
          WETH_ADDRESS[chainId],
          USDC_ADDRESS[chainId],
          OTOKEN_FACTORY,
          GAMMA_CONTROLLER,
          MARGIN_POOL,
          swapContract.address
        );
      });

      it("initializes with correct values", async function () {
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
        assert.equal(minimumSupply, params.minimumSupply);
        assert.equal(isPut, params.isPut);
        assert.equal(
          (await vault.premiumDiscount()).toString(),
          params.premiumDiscount.toString()
        );
        assert.bnEqual(
          cap,
          parseUnits("500", tokenDecimals > 18 ? tokenDecimals : 18)
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
            ],
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
            [
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
            ],
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
            [
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
            ],
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
            [
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
            ],
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
              optionsPremiumPricer.address,
              strikeSelection.address,
              premiumDiscount,
            ],
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

    describe("#setOptionsPremiumPricer", () => {
      time.revertToSnapshotAfterTest();

      it("set new options premium pricer contract to owner", async function () {
        assert.equal(
          await vault.optionsPremiumPricer(),
          optionsPremiumPricer.address
        );
        await vault.connect(ownerSigner).setOptionsPremiumPricer(owner);
        assert.equal(await vault.optionsPremiumPricer(), owner);
      });

      it("reverts when not owner call", async function () {
        await expect(vault.setOptionsPremiumPricer(owner)).to.be.revertedWith(
          "caller is not the owner"
        );
      });
    });

    describe("#setPremiumDiscount", () => {
      time.revertToSnapshotAfterTest();

      it("reverts when not keeper calling", async () => {
        await expect(vault.setPremiumDiscount(100)).to.be.revertedWith(
          "!keeper"
        );
      });

      it("sets the premium discount", async () => {
        await vault.connect(keeperSigner).setPremiumDiscount(800);
        assert.equal((await vault.premiumDiscount()).toString(), 800);
      });

      it("cannot set the premium discount more than 100%", async () => {
        await vault.connect(keeperSigner).setPremiumDiscount(1000);
        await expect(
          vault.connect(keeperSigner).setPremiumDiscount(1001)
        ).to.be.revertedWith("Invalid discount");
      });

      it("cannot set the premium discount to 0", async () => {
        await expect(
          vault.connect(keeperSigner).setPremiumDiscount(0)
        ).to.be.revertedWith("Invalid discount");
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

    // Only apply to when assets is WETH
    if (params.collateralAsset === WETH_ADDRESS[chainId]) {
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
        if (params.collateralAsset === WETH_ADDRESS[chainId]) {
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

      it("updates the previous deposit receipt", async function () {
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

        await rollToFirstOption();

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
    });

    describe("#depositFor", () => {
      time.revertToSnapshotAfterEach();
      let creditor: String;

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

      it("tops up existing deposit", async function () {
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

      it("fits gas budget for deposits [ @skip-on-coverage ]", async function () {
        await vault.connect(ownerSigner).depositFor(depositAmount, creditor);

        const tx1 = await vault.depositFor(depositAmount, creditor);
        const receipt1 = await tx1.wait();
        assert.isAtMost(
          receipt1.gasUsed.toNumber(),
          params.gasLimits.depositWorstCase
        );

        const tx2 = await vault.depositFor(depositAmount, creditor);
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
          .approve(vault.address, params.depositAmount.mul(2));

        await vault.depositFor(params.depositAmount, creditor);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(creditor);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, params.depositAmount);
        assert.bnEqual(unredeemedShares1, BigNumber.from(0));

        await rollToFirstOption();

        const {
          round: round2,
          amount: amount2,
          unredeemedShares: unredeemedShares2,
        } = await vault.depositReceipts(creditor);

        assert.equal(round2, 1);
        assert.bnEqual(amount2, params.depositAmount);
        assert.bnEqual(unredeemedShares2, BigNumber.from(0));

        await vault.depositFor(params.depositAmount, creditor);

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
        } = await vault.depositReceipts(creditor);

        assert.equal(round3, 2);
        assert.bnEqual(amount3, params.depositAmount);
        assert.bnEqual(unredeemedShares3, params.depositAmount);
      });
    });

    describe("#closeRound", () => {
      time.revertToSnapshotAfterEach();

      it("reverts when previous option has not expired", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToFirstOption();

        const bidMultiplier = 1;
        const otoken = await ethers.getContractAt(
          "IERC20",
          firstOption.address
        );
        const initialOtokenBalance = await otoken.balanceOf(vault.address);

        const offerId = await vault.optionAuctionID();
        const offerDetails = await swapContract.swapOffers(offerId);
        const totalSize = offerDetails.totalSize;
        const minPrice = offerDetails.minPrice;
        const buyAmount = totalSize.div(bidMultiplier);
        const sellAmount = buyAmount.mul(minPrice).div(10 ** 8);

        await assetContract
          .connect(userSigner)
          .approve(swapContract.address, sellAmount);

        const bid: Bid = {
          swapId: offerId.toString(),
          nonce: 1,
          signerWallet: userSigner.address,
          sellAmount: sellAmount.toString(), // > than the minimumPrice
          buyAmount: buyAmount.toString(), // > than minimumBid
          referrer: constants.AddressZero,
        };

        const signedBid = await generateSignedBid(
          chainId,
          swapContract.address,
          userSigner.address,
          bid
        );

        await vault
          .connect(keeperSigner)
          .settleOffer([Object.values(signedBid)]);

        assert.bnLte(
          await otoken.balanceOf(vault.address),
          initialOtokenBalance.div(2)
        );

        await strikeSelection.setDelta(params.deltaSecondOption);
        await expect(
          vault.connect(ownerSigner).closeRound()
        ).to.be.revertedWith("C31");
      });

      it("closes existing short", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        const balance = await assetContract.balanceOf(vault.address);
        const res = await vault
          .connect(ownerSigner)
          .closeRound({ from: owner });

        const receipt = await res.wait();
        const block = await provider.getBlock(receipt.blockNumber);

        const optionState = await vault.optionState();
        const vaultState = await vault.vaultState();

        assert.equal(optionState.currentOption, constants.AddressZero);
        assert.equal(optionState.nextOption, constants.AddressZero);
        assert.equal(
          optionState.nextOptionReadyAt,
          block.timestamp + OPTION_DELAY
        );
        assert.bnEqual(vaultState.lockedAmount, balance);
      });

      it("closes short even when otokens are burned", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToFirstOption();

        await vault.connect(keeperSigner).burnRemainingOTokens();

        await rollToSecondOption(firstOption.strikePrice);

        const controller = await ethers.getContractAt(
          "IController",
          GAMMA_CONTROLLER
        );

        assert.equal(await controller.getAccountVaultCounter(vault.address), 2);
      });

      it("closes short when otokens are partially burned", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToFirstOption();

        const bidMultiplier = 2;
        const otoken = await ethers.getContractAt(
          "IERC20",
          firstOption.address
        );
        const initialOtokenBalance = await otoken.balanceOf(vault.address);

        const offerId = await vault.optionAuctionID();
        const offerDetails = await swapContract.swapOffers(offerId);
        const totalSize = offerDetails.totalSize;
        const minPrice = offerDetails.minPrice;
        const buyAmount = totalSize.div(bidMultiplier);
        const sellAmount = buyAmount.mul(minPrice).div(10 ** 8);

        await assetContract
          .connect(userSigner)
          .approve(swapContract.address, sellAmount);

        const bid: Bid = {
          swapId: offerId.toString(),
          nonce: 1,
          signerWallet: userSigner.address,
          sellAmount: sellAmount.toString(), // > than the minimumPrice
          buyAmount: buyAmount.toString(), // > than minimumBid
          referrer: constants.AddressZero,
        };

        const signedBid = await generateSignedBid(
          chainId,
          swapContract.address,
          userSigner.address,
          bid
        );

        await vault
          .connect(keeperSigner)
          .settleOffer([Object.values(signedBid)]);

        assert.bnLte(
          await otoken.balanceOf(vault.address),
          initialOtokenBalance.div(2)
        );

        await vault.connect(keeperSigner).burnRemainingOTokens();

        await rollToSecondOption(firstOption.strikePrice);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);
        const res = await vault
          .connect(ownerSigner)
          .closeRound({ from: owner });

        const receipt = await res.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 140500);
        // console.log("closeRound", receipt.gasUsed.toNumber());
      });
    });

    describe("#commitNextOption", () => {
      time.revertToSnapshotAfterEach();

      it("reverts when not called with keeper", async function () {
        await expect(
          vault.connect(ownerSigner).commitNextOption()
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when the currentOption is not closed", async function () {
        // Ensure commitNextOption cannot be called if closeRound has not been called
        await expect(
          vault.connect(keeperSigner).commitNextOption()
        ).to.be.revertedWith("Round not closed");
      });

      it("sets the option correctly on the first round", async function () {
        await vault.connect(ownerSigner).closeRound({ from: owner });

        await vault.connect(keeperSigner).commitNextOption();

        const optionState = await vault.optionState();

        assert.equal(optionState.currentOption, constants.AddressZero);
        assert.equal(optionState.nextOption, firstOption.address);
      });

      it("should set the next option twice", async function () {
        const WETH_STRIKE_PRICE = {
          [CHAINID.ETH_MAINNET]: 250000000000, // WETH
          [CHAINID.AVAX_MAINNET]: 20000000000, // WAVAX
        };
        const altStrikePrice = "405000000000";

        const newStrikePrice =
          params.asset === WETH_ADDRESS[chainId]
            ? WETH_STRIKE_PRICE[chainId]
            : altStrikePrice;

        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await vault.connect(ownerSigner).closeRound({ from: owner });

        await vault.connect(keeperSigner).commitNextOption();
        let optionState = await vault.optionState();

        assert.equal(optionState.currentOption, constants.AddressZero);
        assert.equal(optionState.nextOption, firstOption.address);

        await vault.connect(ownerSigner).setStrikePrice(newStrikePrice);
        await vault.connect(keeperSigner).commitNextOption();

        const alternateOptionAddress =
          await oTokenFactory.getTargetOtokenAddress(
            params.asset,
            params.strikeAsset,
            params.collateralAsset,
            newStrikePrice,
            firstOptionExpiry,
            params.isPut
          );

        optionState = await vault.optionState();

        assert.equal(optionState.currentOption, constants.AddressZero);
        assert.equal(optionState.nextOption, alternateOptionAddress);
      });

      it("sets the correct strike when overriding strike price", async function () {
        const WETH_STRIKE_PRICE = {
          [CHAINID.ETH_MAINNET]: 250000000000, // WETH
          [CHAINID.AVAX_MAINNET]: 20000000000, // WAVAX
        };

        const altStrikePrice = "405000000000";
        const newStrikePrice =
          params.asset === WETH_ADDRESS[chainId]
            ? WETH_STRIKE_PRICE[chainId]
            : altStrikePrice;

        await vault.connect(ownerSigner).closeRound({ from: owner });

        await vault.connect(ownerSigner).setStrikePrice(newStrikePrice);

        assert.equal((await vault.lastStrikeOverrideRound()).toString(), "2");
        assert.equal(
          (await vault.overriddenStrikePrice()).toString(),
          newStrikePrice.toString()
        );

        await vault.connect(keeperSigner).commitNextOption();

        assert.equal(
          (
            await (
              await getContractAt("IOtoken", await vault.nextOption())
            ).strikePrice()
          ).toString(),
          newStrikePrice.toString()
        );
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);
        await vault.connect(ownerSigner).closeRound({ from: owner });

        const res = await vault.connect(keeperSigner).commitNextOption();

        const receipt = await res.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 935100);
        // console.log("commitNextOption", receipt.gasUsed.toNumber());
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
        await rollToFirstOption();

        await expect(
          vault.connect(ownerSigner).burnRemainingOTokens()
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when trying to burn 0 OTokens", async function () {
        await rollToFirstOption();

        let bidMultiplier = 1;

        const offerId = await vault.optionAuctionID();
        const offerDetails = await swapContract.swapOffers(offerId);
        const totalSize = offerDetails.totalSize;
        const minPrice = offerDetails.minPrice;
        const buyAmount = totalSize.div(bidMultiplier);
        const sellAmount = buyAmount.mul(minPrice).div(10 ** 8);

        await assetContract
          .connect(userSigner)
          .approve(swapContract.address, sellAmount);

        const bid: Bid = {
          swapId: offerId.toString(),
          nonce: 1,
          signerWallet: userSigner.address,
          sellAmount: sellAmount.toString(), // > than the minimumPrice
          buyAmount: buyAmount.toString(), // > than minimumBid
          referrer: constants.AddressZero,
        };

        const signedBid = await generateSignedBid(
          chainId,
          swapContract.address,
          userSigner.address,
          bid
        );

        let assetBalanceBeforeSettle;

        assetBalanceBeforeSettle = await assetContract.balanceOf(vault.address);

        await vault
          .connect(keeperSigner)
          .settleOffer([Object.values(signedBid)]);

        assert.equal(
          (await defaultOtoken.balanceOf(vault.address)).toString(),
          "0"
        );

        let assetBalanceAfterSettle = await assetContract.balanceOf(
          vault.address
        );

        assert.equal(
          assetBalanceAfterSettle.toString(),
          assetBalanceBeforeSettle.add(BigNumber.from(sellAmount)).toString()
        );

        await expect(
          vault.connect(keeperSigner).burnRemainingOTokens()
        ).to.be.revertedWith("No oTokens to burn");
      });

      it("burns all remaining oTokens", async function () {
        await rollToFirstOption();

        let bidMultiplier = 2;

        const offerId = await vault.optionAuctionID();
        const offerDetails = await swapContract.swapOffers(offerId);
        const totalSize = offerDetails.totalSize;
        const minPrice = offerDetails.minPrice;
        const buyAmount = totalSize.div(bidMultiplier);
        const sellAmount = buyAmount.mul(minPrice).div(10 ** 8);

        await assetContract
          .connect(userSigner)
          .approve(swapContract.address, sellAmount);

        const bid: Bid = {
          swapId: offerId.toString(),
          nonce: 1,
          signerWallet: userSigner.address,
          sellAmount: sellAmount.toString(), // > than the minimumPrice
          buyAmount: buyAmount.toString(), // > than minimumBid
          referrer: constants.AddressZero,
        };

        const signedBid = await generateSignedBid(
          chainId,
          swapContract.address,
          userSigner.address,
          bid
        );

        assert.equal(
          (await defaultOtoken.balanceOf(vault.address)).toString(),
          totalSize.toString()
        );

        const assetBalanceBeforeSettle = await assetContract.balanceOf(
          vault.address
        );

        await vault
          .connect(keeperSigner)
          .settleOffer([Object.values(signedBid)]);

        // Asset balance when auction closes only contains auction proceeds
        // Remaining vault's balance is still in Opyn Gamma Controller
        let auctionProceeds = await assetContract.balanceOf(vault.address);

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
              (assetBalanceBeforeSettle.add(auctionProceeds) * 99) /
              100
            ).toString()
          )
        );

        const lockedAmountBeforeBurn = (await vault.vaultState()).lockedAmount;
        const assetBalanceAfterSettle = await assetContract.balanceOf(
          vault.address
        );
        vault.connect(keeperSigner).burnRemainingOTokens();
        const assetBalanceAfterBurn = await assetContract.balanceOf(
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
        await depositIntoVault(params.collateralAsset, vault, depositAmount);

        oracle = await setupOracle(
          params.asset,
          params.chainlinkPricer,
          ownerSigner,
          params.protocol
        );
      });

      it("reverts when not called with keeper", async function () {
        await expect(
          vault.connect(ownerSigner).rollToNextOption()
        ).to.be.revertedWith("!keeper");
      });

      it("reverts when round is not closed", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToFirstOption();

        await vault.connect(keeperSigner).burnRemainingOTokens();

        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!nextOption");
      });

      it("reverts when next option is not commited", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToFirstOption();

        await vault.connect(keeperSigner).burnRemainingOTokens();

        await vault.connect(ownerSigner).closeRound({ from: owner });

        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!nextOption");
      });

      it("allow rolling to the same option", async function () {
        await assetContract.approve(vault.address, depositAmount);
        await depositIntoVault(collateralAsset, vault, depositAmount);

        await rollToFirstOption();

        await vault.connect(keeperSigner).burnRemainingOTokens();

        await vault.connect(ownerSigner).closeRound({ from: owner });

        await vault.connect(keeperSigner).commitNextOption();

        await vault.connect(keeperSigner).rollToNextOption();
      });

      it("mints oTokens and deposits collateral into vault", async function () {
        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        const res = await vault.connect(keeperSigner).rollToNextOption();

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
          (await assetContract.balanceOf(MARGIN_POOL))
            .sub(startMarginBalance)
            .toString(),
          depositAmount.toString()
        );

        assert.bnEqual(
          await defaultOtoken.balanceOf(vault.address),
          params.expectedMintAmount
        );

        assert.equal(await vault.currentOption(), defaultOtokenAddress);
      });

      it("starts offer with correct parameters", async function () {
        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();
        await vault.connect(keeperSigner).commitNextOption();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).rollToNextOption();
        const initialOtokenBalance = await defaultOtoken.balanceOf(
          vault.address
        );

        const offerId = await vault.optionAuctionID();
        const offerDetails = await swapContract.swapOffers(offerId);
        const totalSize = offerDetails.totalSize;
        const minPrice = offerDetails.minPrice;

        assert.equal(offerDetails.oToken, defaultOtokenAddress);
        assert.equal(offerDetails.biddingToken, collateralAsset);

        const minBidSize =
          totalSize > 10 ** tokenDecimals
            ? 10 ** tokenDecimals
            : totalSize / 10;
        assert.equal(offerDetails.minBidSize.toString(), minBidSize);

        const adjustedOtokenPremium =
          tokenDecimals > 18
            ? parseEther("0.01").mul(10 ** (tokenDecimals - 18))
            : parseEther("0.01").div(10 ** (18 - tokenDecimals));

        assert.equal(initialOtokenBalance.toString(), totalSize.toString());
        assert.equal(
          initialOtokenBalance.toString(),
          offerDetails.availableSize.toString()
        );
        assert.equal(adjustedOtokenPremium.toString(), minPrice.toString());
      });

      it("reverts when calling before expiry", async function () {
        const EXPECTED_ERROR = "31";

        const firstOptionAddress = firstOption.address;

        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
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
          vault.connect(ownerSigner).closeRound()
        ).to.be.revertedWith(EXPECTED_ERROR);
      });

      it("withdraws and roll funds into next option, after expiry ITM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;

        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        assert.equal(await vault.currentOption(), firstOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), firstOption.expiry);

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount, keeper);

        await time.increaseTo((await provider.getBlock("latest")).timestamp);

        // We just settle the auction without any bids
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

        const firstCloseTx = await vault.connect(ownerSigner).closeRound();
        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

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

        await vault.connect(keeperSigner).commitNextOption();
        const secondTx = await vault.connect(keeperSigner).rollToNextOption();

        assert.equal(await vault.currentOption(), secondOptionAddress);
        assert.equal(await getCurrentOptionExpiry(), secondOption.expiry);

        await expect(secondTx)
          .to.emit(vault, "OpenShort")
          .withArgs(secondOptionAddress, currBalance, keeper);

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          BigNumber.from(0)
        );
      });

      it("reverts when calling before expiry", async function () {
        const EXPECTED_ERROR = "C31";

        const firstOptionAddress = firstOption.address;

        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();

        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
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
          vault.connect(ownerSigner).closeRound()
        ).to.be.revertedWith(EXPECTED_ERROR);
      });

      it("withdraws and roll funds into next option, after expiry OTM", async function () {
        const firstOptionAddress = firstOption.address;
        const secondOptionAddress = secondOption.address;

        await vault.connect(keeperSigner).setMinPrice(parseEther("0.00551538"));

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        const firstTx = await vault.connect(keeperSigner).rollToNextOption();

        await expect(firstTx)
          .to.emit(vault, "OpenShort")
          .withArgs(firstOptionAddress, depositAmount, keeper);

        let bidMultiplier = 1;

        const offerId = await vault.optionAuctionID();
        const offerDetails = await swapContract.swapOffers(offerId);
        const totalSize = offerDetails.totalSize;
        const minPrice = offerDetails.minPrice;
        const buyAmount = totalSize.div(bidMultiplier);
        const sellAmount = buyAmount.mul(minPrice).div(10 ** 8);

        await assetContract
          .connect(userSigner)
          .approve(swapContract.address, sellAmount);

        const bid: Bid = {
          swapId: offerId.toString(),
          nonce: 1,
          signerWallet: userSigner.address,
          sellAmount: sellAmount.toString(), // > than the minimumPrice
          buyAmount: buyAmount.toString(), // > than minimumBid
          referrer: constants.AddressZero,
        };

        const signedBid = await generateSignedBid(
          chainId,
          swapContract.address,
          userSigner.address,
          bid
        );

        // Check that the vault receives the correct amount of proceeds from the swap
        const tx = await vault
          .connect(keeperSigner)
          .settleOffer([Object.values(signedBid)]);
        let auctionProceeds = await assetContract.balanceOf(vault.address);

        await expect(tx).to.emit(swapContract, "Swap").withArgs(
          offerId.toString(),
          1,
          userSigner.address,
          auctionProceeds, // The sell amount from emitted event should equal to the vault's balance
          buyAmount.toString(),
          constants.AddressZero,
          0
        );

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

        const beforeBalance = await assetContract.balanceOf(vault.address);
        const beforeBalanceAfterFees = beforeBalance
          .sub(auctionProceeds.mul(await vault.performanceFee()).div(10 ** 8))
          .sub(
            auctionProceeds
              .add(depositAmount)
              .mul(await vault.managementFee())
              .div(10 ** 8)
          );

        const secondInitialTotalBalance = await vault.totalBalance();
        let [secondInitialLockedBalance, queuedWithdrawAmount] =
          await lockedBalanceForRollover(vault);
        let pendingAmount = (await vault.vaultState()).totalPending;

        const firstCloseTx = await vault.connect(ownerSigner).closeRound();
        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);

        const afterBalance = await assetContract.balanceOf(vault.address);

        // test that the vault's balance does not decrease after expiring OTM
        // we also need to adjust for fees
        assert.equal(
          parseInt(depositAmount.toString()),
          parseInt(afterBalance.sub(beforeBalanceAfterFees).toString())
        );

        await expect(firstCloseTx)
          .to.emit(vault, "CloseShort")
          .withArgs(
            firstOptionAddress,
            BigNumber.from(afterBalance.sub(beforeBalanceAfterFees)),
            owner
          );

        // Time increase to after next option available
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        const secondTx = await vault.connect(keeperSigner).rollToNextOption();

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
            depositAmount.add(auctionProceeds).sub(vaultFees),
            keeper
          );

        assert.equal(
          (await assetContract.balanceOf(vault.address)).toString(),
          BigNumber.from(0)
        );
      });

      it("withdraws and roll funds into next option, after expiry OTM (initiateWithdraw)", async function () {
        await depositIntoVault(
          params.collateralAsset,
          vault,
          depositAmount,
          ownerSigner
        );
        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        await vault.connect(keeperSigner).rollToNextOption();
        await vault
          .connect(ownerSigner)
          .initiateWithdraw(params.depositAmount.div(2));

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          firstOptionStrike
        );

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        await vault.connect(keeperSigner).rollToNextOption();

        let [, queuedWithdrawAmountInitial] = await lockedBalanceForRollover(
          vault
        );

        let bidMultiplier = 1;

        const offerId = await vault.optionAuctionID();
        const offerDetails = await swapContract.swapOffers(offerId);
        const totalSize = offerDetails.totalSize;
        const minPrice = offerDetails.minPrice;
        const buyAmount = totalSize.div(bidMultiplier);
        const sellAmount = buyAmount.mul(minPrice).div(10 ** 8);

        await assetContract
          .connect(userSigner)
          .approve(swapContract.address, sellAmount);

        const bid: Bid = {
          swapId: offerId.toString(),
          nonce: 1,
          signerWallet: userSigner.address,
          sellAmount: sellAmount.toString(), // > than the minimumPrice
          buyAmount: buyAmount.toString(), // > than minimumBid
          referrer: constants.AddressZero,
        };

        const signedBid = await generateSignedBid(
          chainId,
          swapContract.address,
          userSigner.address,
          bid
        );

        await vault
          .connect(keeperSigner)
          .settleOffer([Object.values(signedBid)]);

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

        await vault.initiateWithdraw(params.depositAmount.div(2));

        let pendingAmount = (await vault.vaultState()).totalPending;
        let [secondInitialLockedBalance, queuedWithdrawAmount] =
          await lockedBalanceForRollover(vault);

        const secondInitialBalance = await vault.totalBalance();

        await vault.connect(ownerSigner).closeRound();

        // Time increase to after next option available
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        await vault.connect(keeperSigner).rollToNextOption();

        let vaultFees = secondInitialLockedBalance
          .add(queuedWithdrawAmount.sub(queuedWithdrawAmountInitial))
          .sub(pendingAmount)
          .mul(await vault.managementFee())
          .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)));
        vaultFees = vaultFees.add(
          secondInitialLockedBalance
            .add(queuedWithdrawAmount.sub(queuedWithdrawAmountInitial))
            .sub((await vault.vaultState()).lastLockedAmount)
            .sub(pendingAmount)
            .mul(await vault.performanceFee())
            .div(BigNumber.from(100).mul(BigNumber.from(10).pow(6)))
        );

        assert.equal(
          secondInitialBalance.sub(await vault.totalBalance()).toString(),
          vaultFees.toString()
        );
      });

      it("is not able to roll to new option consecutively without setNextOption", async function () {
        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        await vault.connect(keeperSigner).rollToNextOption();

        await expect(
          vault.connect(keeperSigner).rollToNextOption()
        ).to.be.revertedWith("!nextOption");
      });

      it("does not debit the user on first deposit", async () => {
        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        // totalBalance should remain the same before and after roll
        const startBalance = await vault.totalBalance();

        await vault.connect(keeperSigner).commitNextOption();
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
        assert.bnLt(await vault.totalBalance(), secondStartBalance);
        assert.bnLt(await vault.accountVaultBalance(user), depositAmount);
      });

      it("fits gas budget [ @skip-on-coverage ]", async function () {
        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);

        await vault.connect(keeperSigner).commitNextOption();
        const tx = await vault.connect(keeperSigner).rollToNextOption();
        const receipt = await tx.wait();

        assert.isAtMost(receipt.gasUsed.toNumber(), 967000); //963542, 1082712
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

        await rollToFirstOption();
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
          params.protocol
        );
      });

      it("is able to redeem deposit at new price per share", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await rollToFirstOption();

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
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await rollToFirstOption();

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
        await vault.deposit(params.depositAmount);
        await rollToFirstOption();

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
        await vault.connect(keeperSigner).setMinPrice(parseEther("0.01"));

        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).commitNextOption();
        await vault.connect(keeperSigner).rollToNextOption();

        // Mid-week deposit in round 2
        await vault.connect(userSigner).deposit(params.depositAmount);

        const vaultState = await vault.vaultState();

        const beforeBalance = (
          await assetContract.balanceOf(vault.address)
        ).add(vaultState.lockedAmount);

        const beforePps = await vault.pricePerShare();

        const AMOUNT = {
          [CHAINID.ETH_MAINNET]: "100000000000",
          [CHAINID.AVAX_MAINNET]: "1000000000",
        };

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(AMOUNT[chainId])
          : firstOptionStrike.add(AMOUNT[chainId]);

        // withdraw 100% because it's OTM
        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          settlementPriceITM
        );

        await strikeSelection.setDelta(params.deltaSecondOption);

        await vault.connect(ownerSigner).closeRound();
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
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await rollToFirstOption();
        await expect(vault.redeem(0)).to.be.revertedWith("!numShares");
      });

      it("reverts when redeeming more than available", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToFirstOption();

        await expect(vault.redeem(depositAmount.add(1))).to.be.revertedWith(
          "Exceeds available"
        );
      });

      it("decreases unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToFirstOption();

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

        await rollToFirstOption();

        await vault.maxRedeem();

        await expect(
          vault.withdrawInstantly(depositAmount.add(1))
        ).to.be.revertedWith("Invalid round");
      });

      it("reverts when withdrawing next round", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToFirstOption();

        await expect(
          vault.withdrawInstantly(depositAmount.add(1))
        ).to.be.revertedWith("Invalid round");
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
      let oracle: Contract;

      time.revertToSnapshotAfterEach(async () => {
        oracle = await setupOracle(
          params.asset,
          params.chainlinkPricer,
          ownerSigner,
          params.protocol
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
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToFirstOption();

        await expect(
          vault.initiateWithdraw(depositAmount.add(1))
        ).to.be.revertedWith("ERC20: transfer amount exceeds balance");
      });

      it("reverts when withdrawing more than vault + account balance", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToFirstOption();

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

        await rollToFirstOption();

        await vault.initiateWithdraw(depositAmount.div(2));

        await setOpynOracleExpiryPrice(
          params.asset,
          oracle,
          await getCurrentOptionExpiry(),
          firstOptionStrike
        );
        await vault.connect(ownerSigner).setStrikePrice(secondOptionStrike);
        await vault.connect(ownerSigner).closeRound();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeperSigner).commitNextOption();
        await vault.connect(keeperSigner).rollToNextOption();

        await expect(
          vault.initiateWithdraw(depositAmount.div(2))
        ).to.be.revertedWith("Existing withdraw");
      });

      it("creates withdrawal from unredeemed shares", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToFirstOption();

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

        await rollToFirstOption();

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

        await rollToFirstOption();

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
      it("reverts when there is insufficient balance over multiple calls", async function () {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await rollToFirstOption();

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

        await rollToFirstOption();

        const tx = await vault.initiateWithdraw(depositAmount);
        const receipt = await tx.wait();
        assert.isAtMost(receipt.gasUsed.toNumber(), 105000);
        // console.log("initiateWithdraw", receipt.gasUsed.toNumber());
      });
    });

    describe("#completeWithdraw", () => {
      time.revertToSnapshotAfterEach(async () => {
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        await rollToFirstOption();

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

        assert.isAtMost(receipt.gasUsed.toNumber(), 100342);
        // console.log(
        //   params.name,
        //   "completeWithdraw",
        //   receipt.gasUsed.toNumber()
        // );
      });
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
        await rollToFirstOption();
        await expect(vault.stake(depositAmount)).to.be.reverted;
      });

      it("reverts when 0 passed", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.deposit(depositAmount);
        await rollToFirstOption();
        await expect(vault.stake(0)).to.be.reverted;
      });

      it("reverts when staking more than available", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(userSigner).deposit(depositAmount);

        await rollToFirstOption();

        await expect(
          vault.connect(userSigner).stake(depositAmount.add(1))
        ).to.be.revertedWith("Exceeds available");
      });

      it("reverts when staking more than available after redeeming", async function () {
        await vault
          .connect(ownerSigner)
          .setLiquidityGauge(liquidityGauge.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(userSigner).deposit(depositAmount);

        await rollToFirstOption();

        await vault.connect(userSigner).maxRedeem();

        await expect(
          vault.connect(userSigner).stake(depositAmount.add(1))
        ).to.be.revertedWith("Exceeds available");
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

        await rollToFirstOption();

        const stakeAmount = BigNumber.from(1);
        const tx1 = await vault.connect(userSigner).stake(stakeAmount);

        await expect(tx1)
          .to.emit(vault, "Redeem")
          .withArgs(user, stakeAmount, 1);

        assert.bnEqual(await liquidityGauge.balanceOf(user), stakeAmount);
        assert.bnEqual(
          await vault.balanceOf(liquidityGauge.address),
          stakeAmount
        );
        assert.bnEqual(await vault.balanceOf(user), userOldBalance);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(user);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, BigNumber.from(0));
        assert.bnEqual(unredeemedShares1, depositAmount.sub(stakeAmount));

        const tx2 = await vault
          .connect(userSigner)
          .stake(depositAmount.sub(stakeAmount));

        await expect(tx2)
          .to.emit(vault, "Redeem")
          .withArgs(user, depositAmount.sub(stakeAmount), 1);

        assert.bnEqual(await liquidityGauge.balanceOf(user), depositAmount);
        assert.bnEqual(
          await vault.balanceOf(liquidityGauge.address),
          depositAmount
        );
        assert.bnEqual(await vault.balanceOf(user), userOldBalance);

        const {
          round: round2,
          amount: amount2,
          unredeemedShares: unredeemedShares2,
        } = await vault.depositReceipts(user);

        assert.equal(round2, 1);
        assert.bnEqual(amount2, BigNumber.from(0));
        assert.bnEqual(unredeemedShares2, BigNumber.from(0));
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

        await rollToFirstOption();

        const stakeAmount = depositAmount.div(2);
        const redeemAmount = depositAmount.div(3);

        await vault.connect(userSigner).redeem(redeemAmount);
        const tx1 = await vault.connect(userSigner).stake(stakeAmount);

        await expect(tx1)
          .to.emit(vault, "Redeem")
          .withArgs(user, stakeAmount.sub(redeemAmount), 1);

        assert.bnEqual(await liquidityGauge.balanceOf(user), stakeAmount);
        assert.bnEqual(
          await vault.balanceOf(liquidityGauge.address),
          stakeAmount
        );
        assert.bnEqual(await vault.balanceOf(user), userOldBalance);

        const {
          round: round1,
          amount: amount1,
          unredeemedShares: unredeemedShares1,
        } = await vault.depositReceipts(user);

        assert.equal(round1, 1);
        assert.bnEqual(amount1, BigNumber.from(0));
        assert.bnEqual(unredeemedShares1, depositAmount.sub(stakeAmount));

        await vault.connect(userSigner).maxRedeem();
        await vault.connect(userSigner).stake(depositAmount.sub(stakeAmount));

        assert.bnEqual(await liquidityGauge.balanceOf(user), depositAmount);
        assert.bnEqual(
          await vault.balanceOf(liquidityGauge.address),
          depositAmount
        );
        assert.bnEqual(await vault.balanceOf(user), userOldBalance);

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
          .withArgs(
            parseUnits("500", tokenDecimals > 18 ? tokenDecimals : 18),
            parseEther("10")
          );
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

        await rollToFirstOption();

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

        await rollToFirstOption();

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

        await rollToFirstOption();

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
        await rollToFirstOption();

        assert.bnEqual(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        // remain the same after deposit
        assert.bnEqual(
          await vault.accountVaultBalance(user),
          BigNumber.from(depositAmount)
        );

        const AMOUNT = {
          [CHAINID.ETH_MAINNET]: "100000000000",
          [CHAINID.AVAX_MAINNET]: "1000000000",
        };

        const settlementPriceITM = isPut
          ? firstOptionStrike.sub(AMOUNT[chainId])
          : firstOptionStrike.add(AMOUNT[chainId]);

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

    if (
      chainId === CHAINID.ETH_MAINNET &&
      params.protocol === OPTION_PROTOCOL.GAMMA &&
      params.mintConfig
    ) {
      describe("pricePerShare checks", () => {
        // Deposit 10000 tokens in the vault (5000 from user 0, 5000 from user 1)
        const totalDepositAmount = parseUnits("10000", params.tokenDecimals);
        const depositAmount = totalDepositAmount.div(2); // 5000

        time.revertToSnapshotAfterEach(async () => {
          // Increase vault cap if it's <10000
          if ((await vault.cap()).lt(totalDepositAmount)) {
            await vault.connect(ownerSigner).setCap(totalDepositAmount);
          }

          await mintToken(
            assetContract,
            params.mintConfig.contractOwnerAddress,
            ownerSigner.address, // User 0
            vault.address,
            totalDepositAmount
          ); // Mint 10000 tokens to user 0

          await assetContract.connect(ownerSigner).transfer(
            userSigner.address, // User 1
            depositAmount
          ); // Transfer 5000 tokens to user 1

          await assetContract
            .connect(ownerSigner)
            .approve(vault.address, depositAmount);
          await vault.connect(ownerSigner).deposit(depositAmount); // User 0 deposits 5000 tokens

          await assetContract
            .connect(userSigner)
            .approve(vault.address, depositAmount);
          await vault.connect(userSigner).deposit(depositAmount); // User 1 deposits 5000 tokens

          assert.bnEqual(await vault.totalBalance(), totalDepositAmount); // 10000 tokens
          await rollToFirstOption(); // Process deposits
          assert.bnEqual(await vault.totalSupply(), totalDepositAmount); // 10000 shares
        });

        it("initiated withdraw is completed in a later round", async function () {
          /* ===== ROUND 2 ===== */

          await vault.connect(userSigner).initiateWithdraw(depositAmount); // User 1 initiates 5000 shares withdraw

          assert.bnEqual(await vault.totalBalance(), totalDepositAmount); // 10000 tokens
          await rollToSecondOption(firstOptionStrike); // Process withdraws
          assert.bnEqual(await vault.totalSupply(), totalDepositAmount); // 10000 shares

          /* ===== ROUND 3 ===== */

          assert.bnEqual(
            await vault.pricePerShare(),
            parseUnits("1", params.tokenDecimals)
          ); // pricePerShare == 1

          // Transfer 50 tokens in premiums to vault
          const premiumAmount = parseUnits("50", params.tokenDecimals);
          await mintToken(
            assetContract,
            params.mintConfig.contractOwnerAddress,
            adminSigner.address,
            vault.address,
            premiumAmount
          ); // Mint 50 tokens
          await assetContract
            .connect(adminSigner)
            .transfer(vault.address, premiumAmount); // Transfer 50 tokens to vault

          await vault.connect(ownerSigner).initiateWithdraw(depositAmount); // User 0 initiates 5000 share withdraw

          assert.bnEqual(
            await vault.totalBalance(),
            totalDepositAmount.add(premiumAmount)
          ); // 10050 tokens
          await rollToSecondOption(firstOptionStrike); // Process premiums/withdraws
          assert.bnEqual(await vault.totalSupply(), totalDepositAmount); // 10000 shares

          /* ===== ROUND 4 ===== */

          // pricePerShare is ~1.0038063
          // console.log((await vault.pricePerShare()).toString());
          assert.bnGt(
            await vault.pricePerShare(),
            parseUnits("1", params.tokenDecimals)
          ); // pricePerShare > 1

          const oneToken = parseUnits("1", params.tokenDecimals); // 1 token
          const tenTokens = parseUnits("10", params.tokenDecimals); // 10 tokens

          let withdrawnTokens0 = await assetContract.balanceOf(
            ownerSigner.address
          );
          await vault.connect(ownerSigner).completeWithdraw();
          withdrawnTokens0 = (
            await assetContract.balanceOf(ownerSigner.address)
          ).sub(withdrawnTokens0); // User 0 completes withdraw of 5000 shares
          // User 0 receives ~5038.063 tokens (5000 tokens + 38.063 premiums)
          // console.log(withdrawnTokens0.toString());
          assert.bnGt(withdrawnTokens0, depositAmount.add(tenTokens.mul(3))); // withdrawnTokens0 > 5030 tokens

          let withdrawnTokens1 = await assetContract.balanceOf(
            userSigner.address
          );
          await vault.connect(userSigner).completeWithdraw();
          withdrawnTokens1 = (
            await assetContract.balanceOf(userSigner.address)
          ).sub(withdrawnTokens1); // User 1 completes withdraw of 5000 shares
          assert.bnEqual(withdrawnTokens1, depositAmount); // User 1 receives 5000 tokens

          // Vault has ~0.000022 in tokens leftover
          // console.log((await vault.totalBalance()).toString());
          assert.bnLt(await vault.totalBalance(), oneToken); // totalBalance < 1 tokens
          assert.bnEqual(await vault.totalSupply(), BigNumber.from(0)); // 0 shares
        });

        it("vault losses locking up withdraws", async function () {
          /* ===== ROUND 2 ===== */

          await vault.connect(userSigner).initiateWithdraw(depositAmount); // User 1 initiates 5000 shares withdraw

          await rollToSecondOption(firstOptionStrike);

          /* ===== ROUND 3 ===== */

          assert.bnEqual(
            await vault.pricePerShare(),
            parseUnits("1", params.tokenDecimals)
          ); // pricePerShare == 1

          await vault.connect(ownerSigner).initiateWithdraw(depositAmount); // User 0 initiates 5000 share withdraw

          const newStrike = isPut
            ? firstOptionStrike.mul(9).div(11)
            : firstOptionStrike.mul(11).div(10); // Set current option to expire ITM

          assert.bnEqual(await vault.totalBalance(), totalDepositAmount); // 10000 tokens
          await rollToSecondOption(newStrike); // Process ITM expiry
          // Vault has ~9090.9090909 tokens
          // console.log((await vault.totalBalance()).toString());
          assert.bnLt(await vault.totalBalance(), totalDepositAmount); // totalBalance < 10000 tokens
          assert.bnEqual(await vault.totalSupply(), totalDepositAmount); // 10000 shares

          /* ===== ROUND 4 ===== */

          // pricePerShare is ~0.90909090
          // console.log((await vault.pricePerShare()).toString());
          assert.bnLt(
            await vault.pricePerShare(),
            parseUnits("1", params.tokenDecimals)
          ); // pricePerShare < 1

          const oneToken = parseUnits("1", params.tokenDecimals); // 1 token

          let withdrawnTokens0 = await assetContract.balanceOf(
            ownerSigner.address
          );
          await vault.connect(ownerSigner).completeWithdraw();
          withdrawnTokens0 = (
            await assetContract.balanceOf(ownerSigner.address)
          ).sub(withdrawnTokens0); // User 0 completes withdraw of 5000 shares
          // User 0 receives ~4545.4545 tokens
          // console.log(withdrawnTokens0.toString());
          assert.bnLt(withdrawnTokens0, depositAmount); // withdrawnTokens0 < 5000 tokens

          const { round, shares } = await vault.withdrawals(userSigner.address);
          const roundPricePerShare = await vault.roundPricePerShare(round);
          const withdrawAmount = shares
            .mul(roundPricePerShare)
            .div(parseUnits("1", params.tokenDecimals));
          // User 1 is expected to receive 5000 tokens when they complete withdraw 5000 shares
          assert.bnEqual(withdrawAmount, depositAmount); // 5000 tokens

          let withdrawnTokens1 = await assetContract.balanceOf(
            userSigner.address
          );
          await vault.connect(userSigner).completeWithdraw();
          withdrawnTokens1 = (
            await assetContract.balanceOf(userSigner.address)
          ).sub(withdrawnTokens1); // User 1 completes withdraw of 5000 shares
          assert.bnEqual(withdrawnTokens1, depositAmount); // User 1 receives 5000 tokens

          // Vault has ~0.00004545 in tokens leftover
          // console.log((await vault.totalBalance()).toString());
          assert.bnLt(await vault.totalBalance(), oneToken); // totalBalance < 1 tokens
          assert.bnEqual(await vault.totalSupply(), BigNumber.from(0)); // 0 shares
        });
      });
    }
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
