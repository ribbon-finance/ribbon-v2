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
  CHAINLINK_WETH_PRICER,
  CHAINID,
  OPTION_PROTOCOL,
  BLOCK_NUMBER,
  ETH_PRICE_ORACLE,
  BTC_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  USDC_ADDRESS,
  USDC_OWNER_ADDRESS,
  WBTC_ADDRESS,
  WBTC_OWNER_ADDRESS,
  WETH_ADDRESS,
  SAVAX_ADDRESS,
  SAVAX_OWNER_ADDRESS,
  SAVAX_PRICER,
  APE_ADDRESS,
  APE_OWNER_ADDRESS,
  APE_PRICER,
  GNOSIS_EASY_AUCTION,
  ManualVolOracle_BYTECODE,
  OptionsPremiumPricerInStables_BYTECODE,
} from "../constants/constants";
import {
  deployProxy,
  setupOracle,
  setOpynOracleExpiryPrice,
  whitelistProduct,
  mintToken,
  bidForOToken,
  decodeOrder,
  lockedBalanceForRollover,
  getDeltaStep,
  getProtocolAddresses,
  getAuctionMinPrice,
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
// const PUT_EXPECTED_MINT_AMOUNT = {
//   [CHAINID.ETH_MAINNET]: "3846153846",
//   [CHAINID.AVAX_MAINNET]: "138888888888",
// };

const chainId = network.config.chainId;

describe("RibbonThetaVault", () => {
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
    auctionDuration: 21600,
    isPut: false,
    gasLimits: {
      depositWorstCase: 101000,
      depositBestCase: 90000,
    },
    mintConfig: {
      amount: parseEther("200"),
      contractOwnerAddress: WBTC_OWNER_ADDRESS[chainId],
    },
    availableChains: [CHAINID.ETH_MAINNET],
    protocol: OPTION_PROTOCOL.GAMMA,
  });

  behavesLikeRibbonOptionsVault({
    name: `Ribbon ETH Theta Vault (Call)`,
    tokenName: "Ribbon ETH Theta Vault",
    tokenSymbol: "rETH-THETA",
    asset: WETH_ADDRESS[chainId],
    assetContractName: "IWETH",
    strikeAsset: USDC_ADDRESS[chainId],
    collateralAsset: WETH_ADDRESS[chainId],
    chainlinkPricer: CHAINLINK_WETH_PRICER[chainId],
    deltaFirstOption: BigNumber.from("1000"),
    deltaSecondOption: BigNumber.from("1000"),
    deltaStep: getDeltaStep("WETH"),
    depositAmount: parseEther("1"),
    minimumSupply: BigNumber.from("10").pow("10").toString(),
    expectedMintAmount: BigNumber.from("100000000"),
    premiumDiscount: BigNumber.from("997"),
    managementFee: BigNumber.from("2000000"),
    performanceFee: BigNumber.from("20000000"),
    auctionDuration: 21600,
    tokenDecimals: 18,
    isPut: false,
    gasLimits: {
      depositWorstCase: 101000,
      depositBestCase: 90000,
    },
    availableChains: [CHAINID.ETH_MAINNET, CHAINID.AVAX_MAINNET],
    protocol: OPTION_PROTOCOL.GAMMA,
  });

  //   behavesLikeRibbonOptionsVault({
  //     name: `Ribbon ETH Theta Vault (Put)`,
  //     tokenName: "Ribbon ETH Theta Vault Put",
  //     tokenSymbol: "rETH-THETA-P",
  //     asset: WETH_ADDRESS[chainId],
  //     assetContractName:
  //       chainId === CHAINID.AVAX_MAINNET ? "IBridgeToken" : "IWBTC",
  //     strikeAsset: USDC_ADDRESS[chainId],
  //     collateralAsset: USDC_ADDRESS[chainId],
  //     chainlinkPricer: CHAINLINK_WETH_PRICER[chainId],
  //     deltaFirstOption: BigNumber.from("1000"),
  //     deltaSecondOption: BigNumber.from("1000"),
  //     deltaStep: getDeltaStep("WETH"),
  //     depositAmount: BigNumber.from("100000000000"),
  //     premiumDiscount: BigNumber.from("997"),
  //     managementFee: BigNumber.from("2000000"),
  //     performanceFee: BigNumber.from("20000000"),
  //     minimumSupply: BigNumber.from("10").pow("3").toString(),
  //     expectedMintAmount: BigNumber.from(PUT_EXPECTED_MINT_AMOUNT[chainId]),
  //     auctionDuration: 21600,
  //     tokenDecimals: 6,
  //     isPut: true,
  //     gasLimits: {
  //       depositWorstCase: 115000,
  //       depositBestCase: 98000,
  //     },
  //     mintConfig: {
  //       amount: parseUnits("10000000", 6),
  //       contractOwnerAddress: USDC_OWNER_ADDRESS[chainId],
  //     },
  //     availableChains: [CHAINID.ETH_MAINNET, CHAINID.AVAX_MAINNET],
  //     protocol: OPTION_PROTOCOL.GAMMA,
  //   });

  //   behavesLikeRibbonOptionsVault({
  //     name: `Ribbon SAVAX Theta Vault (Call)`,
  //     tokenName: "Ribbon SAVAX Theta Vault",
  //     tokenSymbol: "rSAVAX-THETA",
  //     asset: SAVAX_ADDRESS[chainId],
  //     assetContractName: "IWBTC",
  //     strikeAsset: USDC_ADDRESS[chainId],
  //     collateralAsset: SAVAX_ADDRESS[chainId],
  //     chainlinkPricer: SAVAX_PRICER,
  //     deltaFirstOption: BigNumber.from("1000"),
  //     deltaSecondOption: BigNumber.from("1000"),
  //     deltaStep: getDeltaStep("SAVAX"),
  //     depositAmount: parseEther("1"),
  //     minimumSupply: BigNumber.from("10").pow("10").toString(),
  //     expectedMintAmount: BigNumber.from("100000000"),
  //     premiumDiscount: BigNumber.from("997"),
  //     managementFee: BigNumber.from("2000000"),
  //     performanceFee: BigNumber.from("20000000"),
  //     auctionDuration: 21600,
  //     tokenDecimals: 18,
  //     isPut: false,
  //     gasLimits: {
  //       depositWorstCase: 109576,
  //       depositBestCase: 93300,
  //     },
  //     mintConfig: {
  //       amount: parseEther("20"),
  //       contractOwnerAddress: SAVAX_OWNER_ADDRESS[chainId],
  //     },
  //     availableChains: [CHAINID.AVAX_MAINNET],
  //     protocol: OPTION_PROTOCOL.GAMMA,
  //   });

  //   behavesLikeRibbonOptionsVault({
  //     name: `Ribbon APE Theta Vault (Call)`,
  //     tokenName: "Ribbon APE Theta Vault",
  //     tokenSymbol: "rAPE-THETA",
  //     asset: APE_ADDRESS[chainId],
  //     assetContractName: "IWBTC",
  //     strikeAsset: USDC_ADDRESS[chainId],
  //     collateralAsset: APE_ADDRESS[chainId],
  //     chainlinkPricer: APE_PRICER[chainId],
  //     deltaFirstOption: BigNumber.from("1000"),
  //     deltaSecondOption: BigNumber.from("1000"),
  //     deltaStep: getDeltaStep("APE"),
  //     depositAmount: parseEther("1"),
  //     minimumSupply: BigNumber.from("10").pow("10").toString(),
  //     expectedMintAmount: BigNumber.from("100000000"),
  //     premiumDiscount: BigNumber.from("997"),
  //     managementFee: BigNumber.from("2000000"),
  //     performanceFee: BigNumber.from("20000000"),
  //     auctionDuration: 21600,
  //     tokenDecimals: 18,
  //     isPut: false,
  //     gasLimits: {
  //       depositWorstCase: 109576,
  //       depositBestCase: 93200,
  //     },
  //     mintConfig: {
  //       amount: parseEther("20"),
  //       contractOwnerAddress: APE_OWNER_ADDRESS[chainId],
  //     },
  //     availableChains: [CHAINID.ETH_MAINNET],
  //     protocol: OPTION_PROTOCOL.TD,
  //   });
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
 * @param {number} params.auctionDuration - Duration of gnosis auction in seconds
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
  let auctionDuration = params.auctionDuration;
  let isPut = params.isPut;

  // Contracts
  let strikeSelection: Contract;
  let volOracle: Contract;
  let optionsPremiumPricer: Contract;
  let gnosisAuction: Contract;
  let vaultLifecycleLib: Contract;
  let vault: Contract;
  let oTokenFactory: Contract;
  let defaultOtoken: Contract;
  let assetContract: Contract;
  let Pauser: Contract;

  // Variables
  let defaultOtokenAddress: string;
  let firstOptionStrike: BigNumber;
  let firstOptionPremium: BigNumber;
  let firstOptionExpiry: number;
  let secondOptionStrike: BigNumber;
  let secondOptionExpiry: number;
  let startMarginBalance: BigNumber;
  let optionId: string;

  describe(`${params.name}`, () => {
    let initSnapshotId: string;
    let firstOption: Option;
    let secondOption: Option;

    const rollToNextOption = async () => {
      await vault.connect(ownerSigner).setVaultPauser(Pauser.address);

      await vault.connect(keeperSigner).setMinPrice(parseEther("0.00551538"));
      await vault.connect(ownerSigner).commitAndClose();
      await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT);
      await strikeSelection.setDelta(params.deltaFirstOption);
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
      await vault.connect(ownerSigner).setVaultPauser(Pauser.address);

      await strikeSelection.setDelta(params.deltaSecondOption);
      await vault.connect(keeperSigner).setMinPrice(parseEther("30"));
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

      const pauserInitArg = [ownerSigner.address, keeperSigner.address];
      Pauser = await deployProxy(
        "RibbonVaultPauser",
        ownerSigner,
        pauserInitArg,
        [WETH_ADDRESS[chainId]]
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

      const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
      vaultLifecycleLib = await VaultLifecycle.deploy();

      gnosisAuction = await getContractAt(
        "IGnosisAuction",
        GNOSIS_EASY_AUCTION[chainId]
      );

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
        GNOSIS_EASY_AUCTION[chainId],
      ];

      vault = (
        await deployProxy(
          "RibbonThetaVault",
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

      firstOptionPremium = parseEther("0.00553198");

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

    describe("#pause", () => {
      time.revertToSnapshotAfterEach(async function () {
        await vault.connect(ownerSigner).setVaultPauser(Pauser.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await assetContract
          .connect(userSigner)
          .approve(Pauser.address, params.depositAmount);

        await rollToNextOption();
      });

      it("is able to pause position", async function () {
        const tx = await vault.pausePosition();

        // check paused position is saved under user
        let positions = await Pauser.getPausePositions(vault.address, user);
        await expect(tx)
          .to.emit(Pauser, "Pause")
          .withArgs(user, vault.address, depositAmount, 2);

        assert.equal(positions.length, 1);
        assert.equal(positions[0].round, 2);
        assert.equal(positions[0].account, user);
        assert.bnEqual(positions[0].shares, params.depositAmount);

        const results = await vault.withdrawals(Pauser.address);

        assert.equal(await results.round, 2);
        assert.bnEqual(await results.shares, params.depositAmount);
      });
    });

    describe("#processWithdrawal", () => {
      time.revertToSnapshotAfterEach(async () => {
        await vault.connect(ownerSigner).setVaultPauser(Pauser.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await assetContract
          .connect(userSigner)
          .approve(Pauser.address, params.depositAmount);

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        await rollToNextOption();

        await vault.pausePosition();
      });

      it("process withdrawal", async function () {
        await rollToSecondOption(firstOptionStrike);

        const tx = await Pauser.connect(keeperSigner).processWithdrawal(
          vault.address,
          {
            gasPrice,
          }
        );

        await expect(tx)
          .to.emit(Pauser, "ProcessWithdrawal")
          .withArgs(vault.address, 2);

        // withdrawal receipt should be empty
        const { shares, round } = await vault.withdrawals(Pauser.address);
        assert.equal(shares, 0);
        assert.equal(round, 2);
      });
    });

    describe("#resumePosition", () => {
      time.revertToSnapshotAfterEach(async () => {
        await vault.connect(ownerSigner).setVaultPauser(Pauser.address);

        //approving
        await assetContract
          .connect(userSigner)
          .approve(vault.address, depositAmount.mul(2));

        await assetContract
          .connect(userSigner)
          .approve(Pauser.address, depositAmount.mul(2));

        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);

        // transfer some to owner to deposit
        await assetContract.connect(userSigner).transfer(owner, depositAmount);

        //deposit
        if (params.collateralAsset === WETH_ADDRESS[chainId]) {
          await vault.depositETH({ value: depositAmount, gasPrice });
          await vault
            .connect(ownerSigner)
            .depositETH({ value: depositAmount, gasPrice });
        } else {
          await vault.deposit(depositAmount);
          await vault.connect(ownerSigner).deposit(depositAmount);
        }

        await rollToNextOption();

        await vault.pausePosition();

        await rollToSecondOption(firstOptionStrike);

        await Pauser.connect(keeperSigner).processWithdrawal(vault.address, {
          gasPrice,
        });
      });

      it("resume position", async function () {
        const res = await Pauser.connect(userSigner).resumePosition(
          vault.address
        );

        await expect(res)
          .to.emit(Pauser, "Resume")
          .withArgs(user, vault.address, depositAmount);

        await expect(res).to.emit(vault, "Deposit");

        assert.bnEqual(await vault.totalPending(), depositAmount);
        const receipt = await vault.depositReceipts(user);
        assert.equal(receipt.round, 3);
        assert.bnEqual(receipt.amount, depositAmount);
      });
    });

    describe("#processAndPauseAgain", () => {
      time.revertToSnapshotAfterEach(async () => {
        await vault.connect(ownerSigner).setVaultPauser(Pauser.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await assetContract
          .connect(userSigner)
          .approve(Pauser.address, params.depositAmount);

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        await rollToNextOption();

        await vault.pausePosition();
      });

      it("process withdrawal and pause again", async function () {
        await rollToSecondOption(firstOptionStrike);
        await Pauser.connect(keeperSigner).processWithdrawal(vault.address, {
          gasPrice,
        });
        // Deposit and Pause again
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);
        await vault.deposit(params.depositAmount);
        await rollToSecondOption(firstOptionStrike);
        await vault.pausePosition();
        // check paused position is saved under user
        let positions = await Pauser.getPausePositions(vault.address, user);
        assert.equal(positions.length, 2);
        assert.equal(positions[1].round, 4);
        assert.equal(positions[1].account, user);
        assert.bnEqual(positions[1].shares, params.depositAmount);
      });
    });

    describe("#pauseProcessTwiceAndResume", () => {
      time.revertToSnapshotAfterEach(async () => {
        await vault.connect(ownerSigner).setVaultPauser(Pauser.address);

        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);

        await vault.deposit(params.depositAmount);

        await assetContract
          .connect(userSigner)
          .approve(Pauser.address, params.depositAmount);

        await assetContract.connect(userSigner).transfer(owner, depositAmount);
        await assetContract
          .connect(ownerSigner)
          .approve(vault.address, depositAmount);
        await vault.connect(ownerSigner).deposit(depositAmount);

        await rollToNextOption();

        await vault.pausePosition();
      });

      it("pause process twice and resume", async function () {
        await rollToSecondOption(firstOptionStrike);
        await Pauser.connect(keeperSigner).processWithdrawal(vault.address, {
          gasPrice,
        });
        // Deposit and Pause again
        await assetContract
          .connect(userSigner)
          .approve(vault.address, params.depositAmount);
        await vault.deposit(params.depositAmount);
        await rollToSecondOption(firstOptionStrike);
        await vault.pausePosition();
        await rollToSecondOption(firstOptionStrike);
        await Pauser.connect(keeperSigner).processWithdrawal(vault.address, {
          gasPrice,
        });

        // Resume Position
        const res = await Pauser.connect(userSigner).resumePosition(
          vault.address
        );
        await expect(res)
          .to.emit(Pauser, "Resume")
          .withArgs(user, vault.address, depositAmount.mul(2));

        assert.bnEqual(await vault.totalPending(), depositAmount.mul(2));
        const receipt = await vault.depositReceipts(user);
        assert.bnEqual(receipt.amount, depositAmount.mul(2));

        // user's position should be deleted
        let positions = await Pauser.getPausePositions(vault.address, user);
        await expect(positions.round).to.be.undefined;
        await expect(positions.account).to.be.undefined;
        await expect(positions.shares).to.be.undefined;
      });
    });
  });
}
