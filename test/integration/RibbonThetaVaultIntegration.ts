import { BigNumber } from "@ethersproject/bignumber";
import { parseEther } from "@ethersproject/units";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { formatUnits, parseUnits } from "ethers/lib/utils";
import hre from "hardhat";
import moment from "moment-timezone";
import {
  EASY_AUCTION_KOVAN,
  GNOSIS_EASY_AUCTION,
  KOVAN_USDC,
  KOVAN_WETH,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/constants";
import { assert } from "../helpers/assertions";
import { getGasPrice as getGasPriceFromEtherscan } from "../../scripts/helpers/getGasPrice";

moment.tz.setDefault("UTC");

const { deployments, ethers } = hre;

let user: string;
let userSigner: SignerWithAddress;
let owner: string;
let ownerSigner: SignerWithAddress;
let feeRecipient: string;

const weth = hre.network.name === "mainnet" ? WETH_ADDRESS : KOVAN_WETH;
const usdc = hre.network.name === "mainnet" ? USDC_ADDRESS : KOVAN_USDC;
const auctionAddress =
  hre.network.name === "mainnet" ? GNOSIS_EASY_AUCTION : EASY_AUCTION_KOVAN;

const getGasPrice = async () => {
  if (hre.network.name === "mainnet") {
    return await getGasPriceFromEtherscan();
  }
  return parseUnits("1", "gwei");
};

describe("Integration-RibbonThetaVault", () => {
  behavesLikeRibbonThetaVault({
    deploymentName: "RibbonThetaVaultETHCall",
    depositAmount: parseEther("0.0001"),
    isPut: false,
  });

  behavesLikeRibbonThetaVault({
    deploymentName: "RibbonThetaVaultWBTCCall",
    depositAmount: parseUnits("0.0001", 8),
    isPut: false,
  });

  before(async () => {
    const {
      deployer,
      owner: _owner,
      feeRecipient: _feeRecipient,
    } = await hre.getNamedAccounts();
    owner = _owner;
    feeRecipient = _feeRecipient;
    user = deployer;
    userSigner = await ethers.getSigner(user);
    ownerSigner = await ethers.getSigner(owner);
  });

  function behavesLikeRibbonThetaVault({
    deploymentName,
    depositAmount,
    isPut,
  }: {
    deploymentName: string;
    depositAmount: BigNumber;
    isPut: boolean;
  }) {
    describe(deploymentName, () => {
      let vault: Contract;
      let assetContract: Contract;
      let underlying: string;
      let pricer: string;
      let strikeSelection: string;
      let pricerContract: Contract;

      before(async () => {
        const { address } = await deployments.get(deploymentName);
        vault = await ethers.getContractAt(
          "RibbonThetaVault",
          address,
          userSigner
        );
        const { asset, underlying: _underlying } = await vault.vaultParams();
        underlying = _underlying;
        assetContract = await ethers.getContractAt("IERC20", asset, userSigner);
        pricer = await vault.optionsPremiumPricer();
        strikeSelection = await vault.strikeSelection();

        const { abi: pricerABI } = await deployments.get(
          "OptionsPremiumPricerETH"
        );

        pricerContract = await ethers.getContractAt(
          pricerABI,
          pricer,
          ownerSigner
        );
        const poolAddress = await pricerContract.pool();

        const { address: volOracleAddress, abi: volOracleABI } =
          await deployments.get("ManualVolOracle");
        const volOracle = await ethers.getContractAt(
          volOracleABI,
          volOracleAddress,
          ownerSigner
        );

        const annualizedVol = await volOracle.annualizedVol(poolAddress);
        if (annualizedVol.isZero()) {
          const setTx = await volOracle.setAnnualizedVol(
            poolAddress,
            parseUnits("1", 8)
          );
          await setTx.wait();
        }
      });

      const depositIntoVault = async (vault: Contract) => {
        const beforeVaultBalance = await assetContract.balanceOf(vault.address);
        const beforeShares = await vault.balanceOf(user);

        const approveTx = await assetContract.approve(
          vault.address,
          depositAmount,
          { gasPrice: await getGasPrice() }
        );
        await approveTx.wait();

        const depositTx = await vault.deposit(depositAmount, {
          gasPrice: await getGasPrice(),
        });
        await depositTx.wait();

        assert.bnEqual(
          await assetContract.balanceOf(vault.address),
          beforeVaultBalance.add(depositAmount)
        );
        // No change in shares
        assert.bnEqual(await vault.balanceOf(user), beforeShares);
      };

      describe("deposit", () => {
        it("deposits successfully", async () => {
          const { amount: beforeAmount } = await vault.depositReceipts(user);

          await depositIntoVault(vault);

          const { amount, unredeemedShares } = await vault.depositReceipts(
            user
          );
          assert.bnEqual(amount, beforeAmount.add(depositAmount));
          assert.equal(unredeemedShares, 0);
        });
      });

      describe("withdrawInstantly", () => {
        it("withdraws instantly", async () => {
          await depositIntoVault(vault);

          const { amount: beforeAmount } = await vault.depositReceipts(user);
          let beforeBalance: BigNumber;
          if (assetContract.address === weth) {
            beforeBalance = await ethers.provider.getBalance(user);
          } else {
            beforeBalance = await assetContract.balanceOf(user);
          }

          const gasPrice = await getGasPrice();

          const withdrawTx = await vault.withdrawInstantly(depositAmount, {
            gasPrice,
          });
          const receipt = await withdrawTx.wait();

          const { amount, unredeemedShares } = await vault.depositReceipts(
            user
          );
          assert.bnEqual(amount, beforeAmount.sub(depositAmount));
          assert.equal(unredeemedShares, 0);

          if (assetContract.address === weth) {
            const gasFee = gasPrice.mul(receipt.gasUsed);
            assert.bnEqual(
              await ethers.provider.getBalance(user),
              beforeBalance.add(depositAmount).sub(gasFee)
            );
          } else {
            assert.bnEqual(
              await assetContract.balanceOf(user),
              beforeBalance.add(depositAmount)
            );
          }
        });
      });

      describe("initialize", () => {
        it("cannot call initialize", async () => {
          const args = [
            owner,
            feeRecipient,
            0,
            0,
            "Ribbon ETH Theta Vault",
            "rETH-THETA",
            pricer,
            strikeSelection,
            50, //5% discount
            3600, // 1 hour auction duration
            {
              isPut: false,
              decimals: 18,
              asset: assetContract.address,
              underlying,
              minimumSupply: BigNumber.from(10).pow(10),
              cap: parseEther("1000"),
            },
          ];
          try {
            await vault.initialize(...args);
          } catch (e) {
            expect(e).to.be.an("error");
          }
        });
      });

      describe("initiateWithdraw", () => {
        it("initiates a withdrawal", async () => {
          const { heldByVault: beforeHeldByVault } = await vault.shareBalances(
            user
          );

          const tx = await vault.initiateWithdraw(depositAmount);
          await tx.wait();

          const { heldByVault: afterHeldByVault, heldByAccount } =
            await vault.shareBalances(user);

          assert.bnEqual(afterHeldByVault, BigNumber.from(0));
          assert.bnEqual(heldByAccount, beforeHeldByVault.sub(depositAmount));
        });
      });

      describe("commitAndClose", () => {
        it("commits and close prior position", async () => {
          const { nextOption: beforeNextOption } = await vault.optionState();
          // We need to skip the commitAndClose test because it has already been committed
          if (beforeNextOption !== ethers.constants.AddressZero) {
            return;
          }

          const { timestamp } = await ethers.provider.getBlock("latest");
          const commitTx = await vault.commitAndClose({ gasLimit: 900000 });
          const receipt = await commitTx.wait();
          console.log(`commitAndClose took ${receipt.gasUsed} gas`);

          let thisFriday: number;

          if (moment(new Date()).weekday() >= 5) {
            thisFriday = moment(new Date())
              .startOf("isoWeek")
              .add(1, "week")
              .day("friday")
              .hour(8)
              .minutes(0)
              .seconds(0)
              .milliseconds(0)
              .unix();
          } else {
            thisFriday = moment(new Date())
              .startOf("isoWeek")
              .day("friday")
              .hour(8)
              .minutes(0)
              .seconds(0)
              .milliseconds(0)
              .unix();
          }

          const { currentOption, nextOption, nextOptionReadyAt } =
            await vault.optionState();
          assert.notEqual(nextOption, ethers.constants.AddressZero);
          assert.equal(currentOption, ethers.constants.AddressZero);
          assert.isAtLeast(nextOptionReadyAt, timestamp + 3600);

          const otoken = await ethers.getContractAt("IOtoken", nextOption);

          assert.equal(await otoken.expiryTimestamp(), thisFriday);
          assert.equal(await otoken.isPut(), isPut);
          assert.equal(await otoken.collateralAsset(), assetContract.address);
          assert.equal(await otoken.underlyingAsset(), underlying);
          assert.equal(await otoken.strikeAsset(), usdc);

          const underlyingSpotPrice = await pricerContract.getUnderlyingPrice();
          const strikePrice = await otoken.strikePrice();
          const strikePriceStr = formatUnits(strikePrice, 8);
          console.log(`Selected strike price ${strikePriceStr}`);

          if (isPut) {
            assert.bnLt(strikePrice, underlyingSpotPrice);
          } else {
            assert.bnGt(strikePrice, underlyingSpotPrice);
          }
        });
      });

      describe("rollToNextOption", () => {
        it("rolls funds to next option", async () => {
          const { nextOption: beforeNextOption } = await vault.optionState();
          // We need to skip the rollToNextOption test because it has already been rolled
          if (beforeNextOption === ethers.constants.AddressZero) {
            return;
          }

          try {
            await vault.connect(userSigner).rollToNextOption();
          } catch (e) {
            expect(e).to.be.an("error");
          }

          const tx = await vault.connect(ownerSigner).rollToNextOption();
          const receipt = await tx.wait();
          console.log(`rollToNextOption took ${receipt.gasUsed} gas`);

          const { currentOption, nextOption, nextOptionReadyAt } =
            await vault.optionState();

          assert.equal(nextOption, ethers.constants.AddressZero);
          assert.notEqual(currentOption, ethers.constants.AddressZero);
          assert.isAtLeast(nextOptionReadyAt, 1);

          // Check auction parameters
          const auctionID = await vault.optionAuctionID();
          const auction = await ethers.getContractAt(
            "IGnosisAuction",
            auctionAddress
          );
          const { auctioningToken, biddingToken, auctionEndDate } =
            await auction.auctionData(auctionID);
          assert.equal(auctioningToken, currentOption);
          assert.equal(biddingToken, assetContract.address);
          console.log(
            `Auction ends at: ${moment.unix(auctionEndDate).toString()}`
          );

          // 100% should be transferred into Opyn
          assert.isTrue(
            (await assetContract.balanceOf(vault.address)).isZero()
          );

          const otoken = await ethers.getContractAt("IERC20", currentOption);
          assert.bnGt(
            await otoken.balanceOf(auctionAddress),
            BigNumber.from(0)
          );
        });
      });

      describe("GnosisAuction.settleAuction", () => {
        it("settles the auction", async () => {
          const auctionID = await vault.optionAuctionID();
          const auction = await ethers.getContractAt(
            "IGnosisAuction",
            auctionAddress,
            userSigner
          );
          const tx = await auction.settleAuction(auctionID);
          await tx.wait();

          const { currentOption } = await vault.optionState();
          const otoken = await ethers.getContractAt("IERC20", currentOption);

          assert.bnEqual(
            await otoken.balanceOf(auctionAddress),
            BigNumber.from(0)
          );
        });
      });

      describe("burnRemainingOTokens", () => {
        it("burns the remaining otokens", async () => {
          const tx = await vault.connect(ownerSigner).burnRemainingOTokens();
          await tx.wait();

          const { currentOption } = await vault.optionState();
          const otoken = await ethers.getContractAt("IERC20", currentOption);

          assert.bnEqual(
            await otoken.balanceOf(vault.address),
            BigNumber.from(0)
          );
        });
      });
    });
  }
});
