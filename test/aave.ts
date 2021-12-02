import { ethers, network } from "hardhat";
import {
  GAMMA_CONTROLLER,
  GNOSIS_EASY_AUCTION,
  MARGIN_POOL,
  OTOKEN_FACTORY,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../constants/constants";
import { MAINNET_AAVE } from "../scripts/deploy/utils/constants";
import { TEST_URI } from "../scripts/helpers/getDefaultEthersProvider";
import { assert } from "./helpers/assertions";
import * as time from "./helpers/time";
import { setOpynOracleExpiryPrice, setupOracle } from "./helpers/utils";

const { parseEther, formatEther } = ethers.utils;
const keeperAddress = "0xA4290C9EAe274c7A8FbC57A1E68AdC3E95E7C67e";
const daoAddress = "0xDAEada3d210D2f45874724BeEa03C7d4BBD41674";
const vaultAddress = "0xe63151A0Ed4e5fafdc951D877102cf0977Abd365";
const UPGRADE_ADMIN = "0x223d59FA315D7693dF4238d1a5748c964E615923";

let keeperSigner;
let newImplementation;
let adminSigner;
let signer1;

describe("aave", () => {
  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: TEST_URI[1],
            blockNumber: 13645498, // 13689362
          },
        },
      ],
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [keeperAddress],
    });

    [signer1] = await ethers.getSigners();

    await signer1.sendTransaction({
      to: keeperAddress,
      value: parseEther("7"),
    });

    keeperSigner = await ethers.getSigner(keeperAddress);
    adminSigner = await ethers.getSigner(UPGRADE_ADMIN);

    await signer1.sendTransaction({
      to: UPGRADE_ADMIN,
      value: parseEther("10"),
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [UPGRADE_ADMIN],
    });

    const VaultLifecycle = await ethers.getContractFactory("VaultLifecycle");
    const vaultLifecycleLib = await VaultLifecycle.deploy();

    const RibbonThetaVault = await ethers.getContractFactory(
      "RibbonThetaVault",
      {
        libraries: {
          VaultLifecycle: vaultLifecycleLib.address,
        },
      }
    );
    const newImplementationContract = await RibbonThetaVault.deploy(
      WETH_ADDRESS[1],
      USDC_ADDRESS[1],
      OTOKEN_FACTORY[1],
      GAMMA_CONTROLLER[1],
      MARGIN_POOL[1],
      GNOSIS_EASY_AUCTION[1]
      // "0x0000000000000000000000000000000000000001",
      // "0x0000000000000000000000000000000000000001"
    );
    newImplementation = newImplementationContract.address;
  });

  it("test", async () => {
    const vaultProxy = await ethers.getContractAt(
      "AdminUpgradeabilityProxy",
      vaultAddress
    );

    await vaultProxy.connect(adminSigner).upgradeTo(newImplementation);

    const token = await ethers.getContractAt(
      "IERC20",
      "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"
    );

    const vault = await ethers.getContractAt("RibbonThetaVault", vaultAddress);

    const currentOption = await vault.currentOption();
    const otoken = await ethers.getContractAt("IOtoken", currentOption);
    const expiryTimestamp = await otoken.expiryTimestamp();

    await vault.connect(keeperSigner).burnRemainingOTokens();

    const oracle = await setupOracle(
      "0x204e2F3264B5200BCF0d9AC1c466CafcFa5df182",
      signer1,
      true
    );

    await setOpynOracleExpiryPrice(
      MAINNET_AAVE,
      oracle,
      expiryTimestamp,
      ethers.utils.parseUnits("200", 8)
    );

    await time.increaseTo(1637923543);

    await vault.connect(keeperSigner).commitAndClose();

    await time.increaseTo(1637924935);

    const startBalance = await token.balanceOf(daoAddress);
    const { totalPending, lastLockedAmount, lockedAmount } =
      await vault.vaultState();

    console.log(
      `totalBalance: ${formatEther(await token.balanceOf(vault.address))}`
    );
    console.log(`totalPending: ${formatEther(totalPending)}`);
    console.log(`lockedAmount: ${formatEther(lockedAmount)}`);
    console.log(`lastLockedAmount: ${formatEther(lastLockedAmount)}`);
    console.log(`totalSupply: ${formatEther(await vault.totalSupply())}`);
    console.log(
      `lastQueuedWithdrawAmount: ${formatEther(
        await vault.lastQueuedWithdrawAmount()
      )}`
    );
    console.log(`performanceFee: ${(await vault.performanceFee()).toString()}`);
    console.log(`managementFee: ${(await vault.managementFee()).toString()}`);

    await vault.connect(keeperSigner).rollToNextOption();

    console.log(
      `Charged fee: ${formatEther(
        (await token.balanceOf(daoAddress)).sub(startBalance)
      )} AAVE`
    );
  });
});
