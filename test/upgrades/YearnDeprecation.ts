import { ethers, network } from "hardhat";
import {
  CHAINLINK_WETH_PRICER,
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  MARGIN_POOL,
  OPTION_PROTOCOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
  YEARN_REGISTRY_ADDRESS,
  YVUSDC_V0_4_3,
  YEARN_USDC_PRICER_V0_4_3,
} from "../../constants/constants";
import {
  getAssetPricer,
  objectEquals,
  parseLog,
  serializeMap,
  setOpynOracleExpiryPrice,
  setOpynOracleExpiryPriceYearn,
  setupOracle,
} from "../helpers/utils";
import deployments from "../../constants/deployments.json";
import { BigNumberish, Contract } from "ethers";
import * as time from "../helpers/time";
import { assert } from "../helpers/assertions";
import { BigNumber } from "ethereum-waffle/node_modules/ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { expect } from "chai";
import { parseUnits } from "ethers/lib/utils";
import { TASK_ETHERSCAN_VERIFY } from "hardhat-deploy";

const { parseEther } = ethers.utils;

const UPGRADE_ADMIN = "0x223d59FA315D7693dF4238d1a5748c964E615923";
const KEEPER = "0x55e4b3e3226444Cd4de09778844453bA9fe9cd7c";
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const OWNERADDR = "0x77DA011d5314D80BE59e939c2f7EC2F702E1DCC4";
const USER_ACCOUNT_1 = "0xb576328d591be38fa511e407f1f22544e6a147d2";
const USER_ACCOUNT_2 = "0xeCcDb4930952e049d1731f9a75f0AD5A0B30b2aB";

// UPDATE THESE VALUES BEFORE WE ATTEMPT AN UPGRADE
const FORK_BLOCK = 15087398;

const CHAINID = process.env.CHAINID ? Number(process.env.CHAINID) : 1;

describe("RibbonThetaVault upgrade", () => {
  let vaults: string[] = [];

  before(async function () {
    // We need to checkpoint the contract on mainnet to a past block before the upgrade happens
    // This means the `implementation` is pointing to an old contract
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: FORK_BLOCK,
          },
        },
      ],
    });

    // Fund & impersonate the admin account
    const [userSigner] = await ethers.getSigners();

    await userSigner.sendTransaction({
      to: UPGRADE_ADMIN,
      value: parseEther("10"),
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [UPGRADE_ADMIN],
    });

    const deploymentNames = ["RibbonThetaVaultETHPutYearn"];
    deploymentNames.forEach((name) => vaults.push(deployments.mainnet[name]));
  });
  checkWithdrawal(deployments.mainnet.RibbonThetaVaultETHPutYearn);
});

function checkWithdrawal(vaultAddress: string) {
  describe(`Vault ${vaultAddress}`, () => {
    let newImplementation: string;
    let vaultProxy: Contract;
    let vault: Contract;

    time.revertToSnapshotAfterEach();

    before(async () => {
      const adminSigner = await ethers.provider.getSigner(UPGRADE_ADMIN);

      vaultProxy = await ethers.getContractAt(
        "AdminUpgradeabilityProxy",
        vaultAddress,
        adminSigner
      );
      vault = await ethers.getContractAt("RibbonThetaYearnVault", vaultAddress);

      const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
      const vaultLifecycleLib = await VaultLifecycle.deploy();

      const VaultLifecycleYearn = await ethers.getContractFactory(
        "VaultLifecycleYearn"
      );
      const VaultLifecycleYearnLib = await VaultLifecycleYearn.deploy();

      const RibbonThetaYearnVault = await ethers.getContractFactory(
        "RibbonThetaYearnVault",
        {
          libraries: {
            VaultLifecycle: vaultLifecycleLib.address,
            VaultLifecycleYearn: VaultLifecycleYearnLib.address,
          },
        }
      );
      const newImplementationContract = await RibbonThetaYearnVault.deploy(
        WETH_ADDRESS[CHAINID],
        USDC_ADDRESS[CHAINID],
        OTOKEN_FACTORY[CHAINID],
        GAMMA_CONTROLLER[CHAINID],
        MARGIN_POOL[CHAINID],
        GNOSIS_EASY_AUCTION[CHAINID],
        YEARN_REGISTRY_ADDRESS
      );
      newImplementation = newImplementationContract.address;
    });

    describe("#completeWithdraw", () => {
      time.revertToSnapshotAfterEach();
      let account1: SignerWithAddress;
      let account2: SignerWithAddress;
      let owner: SignerWithAddress;
      let keeper: SignerWithAddress;
      let liquidityGauge: Contract;
      let usdcContract: Contract;

      beforeEach(async function () {
        await vaultProxy.upgradeTo(newImplementation);
        // For deposit and withdrawal testing
        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [USER_ACCOUNT_1],
        });

        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [USER_ACCOUNT_2],
        });

        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [KEEPER],
        });

        await network.provider.request({
          method: "hardhat_impersonateAccount",
          params: [OWNERADDR],
        });

        const [signer] = await ethers.getSigners();

        account1 = await ethers.getSigner(USER_ACCOUNT_1);
        account2 = await ethers.getSigner(USER_ACCOUNT_2);
        keeper = await ethers.getSigner(KEEPER);
        owner = await ethers.getSigner(OWNERADDR);

        // Fund & impersonate the admin account and two users who have locked yvUSDC
        await signer.sendTransaction({
          to: account1.address,
          value: parseEther("100"),
        });

        await signer.sendTransaction({
          to: account2.address,
          value: parseEther("100"),
        });

        await signer.sendTransaction({
          to: owner.address,
          value: parseEther("100"),
        });

        const liquidityGaugeAddress = await vault.liquidityGauge();
        liquidityGauge = await ethers.getContractAt(
          "ILiquidityGauge",
          liquidityGaugeAddress
        );

        usdcContract = await ethers.getContractAt(
          "ERC20",
          USDC_ADDRESS[CHAINID]
        );
      });

      it("test", async () => {
        // Set isYearnPaused to be true
        assert.equal(await vault.isYearnPaused(), false);
        await vault.connect(owner).setYearnPaused(true);
        assert.equal(await vault.isYearnPaused(), true);
        // Roll the vault
        const oracle = await setupOracle(
          WETH_ADDRESS[CHAINID],
          CHAINLINK_WETH_PRICER[CHAINID],
          account1,
          OPTION_PROTOCOL.GAMMA
        );
        const yvContract = await ethers.getContractAt("IYearnVault", await vault.collateralToken());
        
        console.log((await yvContract.pricePerShare()).toString());
        const currentOption = await vault.currentOption();
        const iotoken = await ethers.getContractAt("IOtoken", currentOption);
        const ierc20 = await ethers.getContractAt("IERC20", currentOption);

        const lockedAmount2 = (await vault.vaultState()).lockedAmount;
        console.log("lockedAmount js");
        console.log(lockedAmount2.toString());

        const expiryTimestamp = await iotoken.expiryTimestamp();
        const strikePrice = await iotoken.strikePrice();

        let collateralPricer = YEARN_USDC_PRICER_V0_4_3;
        let collateralPricerSigner = await getAssetPricer(
          collateralPricer,
          account1
        );

        // Use old set expiry price function which includes setExpiryPriceInOracle
        await setOpynOracleExpiryPriceYearn(
          WETH_ADDRESS[CHAINID],
          oracle,
          strikePrice,
          collateralPricerSigner,
          expiryTimestamp
        );

        //////////////////////////////////////////////////////////////////////
        // Roll to next option
        await vault.connect(keeper).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeper).rollToNextOption();

        const currentOption2 = await vault.currentOption();

        const lockedAmount = (await vault.vaultState()).lockedAmount;
        const previousLockedAmount = (
          await vault.vaultState()
        ).lastLockedAmount.toString();

        const iotoken2 = await ethers.getContractAt("IOtoken", currentOption2);
        const strikePrice2 = await iotoken2.strikePrice();
        const ierc20_2 = await ethers.getContractAt("IERC20", currentOption2);
      });

      it("withdraws the correct amount after upgrade", async () => {
        // Set isYearnPaused to be true
        assert.equal(await vault.isYearnPaused(), false);
        await vault.connect(owner).setYearnPaused(true);
        assert.equal(await vault.isYearnPaused(), true);
        // Get initial usdc balance of users
        const initialAcc1USDCBalance = await usdcContract.balanceOf(
          account1.address
        );
        const initialAcc2USDCBalance = await usdcContract.balanceOf(
          account2.address
        );

        const acc1StakedBalance = await liquidityGauge.balanceOf(
          account1.address
        );
        const acc2StakedBalance = await liquidityGauge.balanceOf(
          account2.address
        );

        // Withdraw the staked balance of the users
        await liquidityGauge.connect(account1).withdraw(acc1StakedBalance);
        await liquidityGauge.connect(account2).withdraw(acc2StakedBalance);

        // Get the initial share balance of the users
        const initialAcc1ShareBalance = await vault.shares(account1.address);
        const initialAcc2ShareBalance = await vault.shares(account2.address);

        // Initiate withdrawal
        await vault.connect(account1).initiateWithdraw(initialAcc1ShareBalance);
        await vault.connect(account2).initiateWithdraw(initialAcc2ShareBalance);

        // Ensure share balance remains the same
        assert.bnEqual(await vault.shares(account1.address), BigNumber.from(0));
        assert.bnEqual(await vault.shares(account2.address), BigNumber.from(0));

        // Roll the vault
        const oracle = await setupOracle(
          WETH_ADDRESS[CHAINID],
          CHAINLINK_WETH_PRICER[CHAINID],
          account1,
          OPTION_PROTOCOL.GAMMA
        );

        const decimals = await vault.decimals();
        const currentOption = await vault.currentOption();
        const otoken = await ethers.getContractAt("IOtoken", currentOption);
        const expiryTimestamp = await otoken.expiryTimestamp();
        const strikePrice = await otoken.strikePrice();

        let collateralPricer = YEARN_USDC_PRICER_V0_4_3;
        let collateralPricerSigner = await getAssetPricer(
          collateralPricer,
          account1
        );

        // Use old set expiry price function which includes setExpiryPriceInOracle
        await setOpynOracleExpiryPriceYearn(
          WETH_ADDRESS[CHAINID],
          oracle,
          strikePrice,
          collateralPricerSigner,
          expiryTimestamp
        );

        //////////////////////////////////////////////////////////////////////
        // Roll to next option
        await vault.connect(keeper).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeper).rollToNextOption();

        // Get pricePerShare of previous round
        const currentRound = (await vault.vaultState()).round;
        const pps = await vault.roundPricePerShare(currentRound - 1);

        // // Complete withdrawal
        const gasPrice = parseUnits("30", "gwei");

        const acc1Tx = await vault
          .connect(account1)
          .completeWithdraw({ gasPrice });
        const acc2Tx = await vault
          .connect(account2)
          .completeWithdraw({ gasPrice });

        const acc1Receipt = await acc1Tx.wait();
        const acc2Receipt = await acc2Tx.wait();

        // Check withdrawAmount and withdrawShares are correct
        await expect(acc1Tx)
          .to.emit(vault, "Withdraw")
          .withArgs(
            account1.address,
            initialAcc1ShareBalance.mul(pps).div(10 ** decimals),
            initialAcc1ShareBalance
          );
        await expect(acc2Tx)
          .to.emit(vault, "Withdraw")
          .withArgs(
            account2.address,
            initialAcc2ShareBalance.mul(pps).div(10 ** decimals),
            initialAcc2ShareBalance
          );

        const afterAcc1USDCBalance = await usdcContract.balanceOf(
          account1.address
        );
        const afterAcc2USDCBalance = await usdcContract.balanceOf(
          account2.address
        );

        // Check userBalance after withdraw is correct
        assert.bnEqual(
          initialAcc1USDCBalance.add(
            acc1Receipt.events.find((event) => event.event === "Withdraw")
              .args[1]
          ),
          afterAcc1USDCBalance
        );
        assert.bnEqual(
          initialAcc2USDCBalance.add(
            acc2Receipt.events.find((event) => event.event === "Withdraw")
              .args[1]
          ),
          afterAcc2USDCBalance
        );
      });

      it("withdraws the correct amount for deposits in the same round as upgrade", async () => {
        // Set isYearnPaused to be true
        assert.equal(await vault.isYearnPaused(), false);
        await vault.connect(owner).setYearnPaused(true);
        assert.equal(await vault.isYearnPaused(), true);

        // Get initial usdc balance of users
        const initialAcc1USDCBalance = await usdcContract.balanceOf(
          account1.address
        );
        const initialAcc2USDCBalance = await usdcContract.balanceOf(
          account2.address
        );

        // Deposit new usdc to vault in the same round
        await usdcContract
          .connect(account1)
          .approve(vault.address, initialAcc1USDCBalance);
        await vault.connect(account1).deposit(initialAcc1USDCBalance);
        await usdcContract
          .connect(account2)
          .approve(vault.address, initialAcc2USDCBalance);
        await vault.connect(account2).deposit(initialAcc2USDCBalance);

        const acc1USDCBalanceAfterDeposit = await usdcContract.balanceOf(
          account1.address
        );
        const acc2USDCBalanceAfterDeposit = await usdcContract.balanceOf(
          account2.address
        );

        // Roll the vault
        const oracle = await setupOracle(
          WETH_ADDRESS[CHAINID],
          CHAINLINK_WETH_PRICER[CHAINID],
          account1,
          OPTION_PROTOCOL.GAMMA
        );

        const decimals = await vault.decimals();
        const currentOption = await vault.currentOption();
        const otoken = await ethers.getContractAt("IOtoken", currentOption);
        const expiryTimestamp = await otoken.expiryTimestamp();
        const strikePrice = await otoken.strikePrice();

        let collateralPricer = YEARN_USDC_PRICER_V0_4_3;
        let collateralPricerSigner = await getAssetPricer(
          collateralPricer,
          account1
        );

        // Use old set expiry price function which includes setExpiryPriceInOracle
        await setOpynOracleExpiryPriceYearn(
          WETH_ADDRESS[CHAINID],
          oracle,
          strikePrice,
          collateralPricerSigner,
          expiryTimestamp
        );

        //////////////////////////////////////////////////////////////////////
        // Roll to next option
        await vault.connect(keeper).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeper).rollToNextOption();

        // Get the initial share balance of the users
        const initialAcc1ShareBalance = await vault.shares(account1.address);
        const initialAcc2ShareBalance = await vault.shares(account2.address);

        // Initiate withdrawal
        await vault.connect(account1).initiateWithdraw(initialAcc1ShareBalance);
        await vault.connect(account2).initiateWithdraw(initialAcc2ShareBalance);

        // Ensure share balance remains the same
        assert.bnEqual(await vault.shares(account1.address), BigNumber.from(0));
        assert.bnEqual(await vault.shares(account2.address), BigNumber.from(0));

        //////////////////////////////////////////////////////////////////////
        // Roll to next option and initiate withdrawal
        const currentOption2 = await vault.currentOption();
        const otoken2 = await ethers.getContractAt("IOtoken", currentOption2);
        const expiryTimestamp2 = await otoken2.expiryTimestamp();
        const strikePrice2 = await otoken2.strikePrice();

        // Use set expiry price function which does not includes setExpiryPriceInOracle
        await setOpynOracleExpiryPrice(
          WETH_ADDRESS[CHAINID],
          oracle,
          expiryTimestamp2,
          strikePrice2,
          YVUSDC_V0_4_3
        );

        //////////////////////////////////////////////////////////////////////
        // Roll to next option
        await vault.connect(keeper).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeper).rollToNextOption();

        // Get pricePerShare of previous round
        const currentRound = (await vault.vaultState()).round;
        const pps = await vault.roundPricePerShare(currentRound - 1);

        // // Complete withdrawal
        const gasPrice = parseUnits("30", "gwei");

        const acc1Tx = await vault
          .connect(account1)
          .completeWithdraw({ gasPrice });
        const acc2Tx = await vault
          .connect(account2)
          .completeWithdraw({ gasPrice });

        const acc1Receipt = await acc1Tx.wait();
        const acc2Receipt = await acc2Tx.wait();

        // Check withdrawAmount and withdrawShares are correct
        await expect(acc1Tx)
          .to.emit(vault, "Withdraw")
          .withArgs(
            account1.address,
            initialAcc1ShareBalance.mul(pps).div(10 ** decimals),
            initialAcc1ShareBalance
          );
        await expect(acc2Tx)
          .to.emit(vault, "Withdraw")
          .withArgs(
            account2.address,
            initialAcc2ShareBalance.mul(pps).div(10 ** decimals),
            initialAcc2ShareBalance
          );

        const afterAcc1USDCBalance = await usdcContract.balanceOf(
          account1.address
        );
        const afterAcc2USDCBalance = await usdcContract.balanceOf(
          account2.address
        );

        // Check userBalance after withdraw is correct
        assert.bnEqual(
          acc1USDCBalanceAfterDeposit.add(
            acc1Receipt.events.find((event) => event.event === "Withdraw")
              .args[1]
          ),
          afterAcc1USDCBalance
        );
        assert.bnEqual(
          acc2USDCBalanceAfterDeposit.add(
            acc2Receipt.events.find((event) => event.event === "Withdraw")
              .args[1]
          ),
          afterAcc2USDCBalance
        );
      });

      it("withdraws the correct amount for deposits in the round after upgrade", async () => {
        // Set isYearnPaused to be true
        assert.equal(await vault.isYearnPaused(), false);
        await vault.connect(owner).setYearnPaused(true);
        assert.equal(await vault.isYearnPaused(), true);

        // Roll the vault
        const oracle = await setupOracle(
          WETH_ADDRESS[CHAINID],
          CHAINLINK_WETH_PRICER[CHAINID],
          account1,
          OPTION_PROTOCOL.GAMMA
        );

        const decimals = await vault.decimals();
        const currentOption = await vault.currentOption();
        const otoken = await ethers.getContractAt("IOtoken", currentOption);
        const expiryTimestamp = await otoken.expiryTimestamp();
        const strikePrice = await otoken.strikePrice();

        let collateralPricer = YEARN_USDC_PRICER_V0_4_3;
        let collateralPricerSigner = await getAssetPricer(
          collateralPricer,
          account1
        );

        // Use old set expiry price function which includes setExpiryPriceInOracle
        await setOpynOracleExpiryPriceYearn(
          WETH_ADDRESS[CHAINID],
          oracle,
          strikePrice,
          collateralPricerSigner,
          expiryTimestamp
        );

        //////////////////////////////////////////////////////////////////////
        // Roll to next option
        await vault.connect(keeper).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeper).rollToNextOption();

        // Get initial usdc balance of users
        const initialAcc1USDCBalance = await usdcContract.balanceOf(
          account1.address
        );
        const initialAcc2USDCBalance = await usdcContract.balanceOf(
          account2.address
        );

        // Deposit new usdc to vault
        await usdcContract
          .connect(account1)
          .approve(vault.address, initialAcc1USDCBalance);
        await vault.connect(account1).deposit(initialAcc1USDCBalance);
        await usdcContract
          .connect(account2)
          .approve(vault.address, initialAcc2USDCBalance);
        await vault.connect(account2).deposit(initialAcc2USDCBalance);

        const acc1USDCBalanceAfterDeposit = await usdcContract.balanceOf(
          account1.address
        );
        const acc2USDCBalanceAfterDeposit = await usdcContract.balanceOf(
          account2.address
        );

        const currentOption2 = await vault.currentOption();
        const otoken2 = await ethers.getContractAt("IOtoken", currentOption2);
        const expiryTimestamp2 = await otoken2.expiryTimestamp();
        const strikePrice2 = await otoken.strikePrice();

        // Use set expiry price function which does not includes setExpiryPriceInOracle
        await setOpynOracleExpiryPrice(
          WETH_ADDRESS[CHAINID],
          oracle,
          expiryTimestamp2,
          strikePrice2,
          YVUSDC_V0_4_3
        );

        //////////////////////////////////////////////////////////////////////
        // Roll to next option
        await vault.connect(keeper).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeper).rollToNextOption();

        // Get the initial share balance of the users
        const initialAcc1ShareBalance = await vault.shares(account1.address);
        const initialAcc2ShareBalance = await vault.shares(account2.address);

        // Initiate withdrawal
        await vault.connect(account1).initiateWithdraw(initialAcc1ShareBalance);
        await vault.connect(account2).initiateWithdraw(initialAcc2ShareBalance);

        // Ensure share balance remains the same
        assert.bnEqual(await vault.shares(account1.address), BigNumber.from(0));
        assert.bnEqual(await vault.shares(account2.address), BigNumber.from(0));

        const currentOption3 = await vault.currentOption();
        const otoken3 = await ethers.getContractAt("IOtoken", currentOption3);
        const expiryTimestamp3 = await otoken3.expiryTimestamp();
        const strikePrice3 = await otoken3.strikePrice();

        // Use set expiry price function which does not includes setExpiryPriceInOracle
        await setOpynOracleExpiryPrice(
          WETH_ADDRESS[CHAINID],
          oracle,
          expiryTimestamp3,
          strikePrice3,
          YVUSDC_V0_4_3
        );

        //////////////////////////////////////////////////////////////////////
        // Roll to next option
        await vault.connect(keeper).commitAndClose();
        await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1);
        await vault.connect(keeper).rollToNextOption();

        // Get pricePerShare of previous round
        const currentRound = (await vault.vaultState()).round;
        const pps = await vault.roundPricePerShare(currentRound - 1);

        // // Complete withdrawal
        const gasPrice = parseUnits("30", "gwei");

        const acc1Tx = await vault
          .connect(account1)
          .completeWithdraw({ gasPrice });
        const acc2Tx = await vault
          .connect(account2)
          .completeWithdraw({ gasPrice });

        const acc1Receipt = await acc1Tx.wait();
        const acc2Receipt = await acc2Tx.wait();

        // Check withdrawAmount and withdrawShares are correct
        await expect(acc1Tx)
          .to.emit(vault, "Withdraw")
          .withArgs(
            account1.address,
            initialAcc1ShareBalance.mul(pps).div(10 ** decimals),
            initialAcc1ShareBalance
          );
        await expect(acc2Tx)
          .to.emit(vault, "Withdraw")
          .withArgs(
            account2.address,
            initialAcc2ShareBalance.mul(pps).div(10 ** decimals),
            initialAcc2ShareBalance
          );

        const acc1USDCBalanceAfterWithdraw = await usdcContract.balanceOf(
          account1.address
        );
        const acc2USDCBalanceAfterWIthdraw = await usdcContract.balanceOf(
          account2.address
        );

        // Check userBalance after withdraw is correct
        assert.bnEqual(
          acc1USDCBalanceAfterDeposit.add(
            acc1Receipt.events.find((event) => event.event === "Withdraw")
              .args[1]
          ),
          acc1USDCBalanceAfterWithdraw
        );
        assert.bnEqual(
          acc2USDCBalanceAfterDeposit.add(
            acc2Receipt.events.find((event) => event.event === "Withdraw")
              .args[1]
          ),
          acc2USDCBalanceAfterWIthdraw
        );
      });
    });
  });
}
