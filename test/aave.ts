import { ethers, network } from "hardhat";
import { TEST_URI } from "../scripts/helpers/getDefaultEthersProvider";
import { assert } from "./helpers/assertions";

const { parseEther, formatEther } = ethers.utils;
const keeperAddress = "0xA4290C9EAe274c7A8FbC57A1E68AdC3E95E7C67e";
const daoAddress = "0xDAEada3d210D2f45874724BeEa03C7d4BBD41674";

let keeperSigner;

describe("aave", () => {
  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: TEST_URI[1],
            blockNumber: 13689362,
          },
        },
      ],
    });

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [keeperAddress],
    });

    const [signer1] = await ethers.getSigners();

    await signer1.sendTransaction({
      to: keeperAddress,
      value: parseEther("7"),
    });

    keeperSigner = await ethers.getSigner(keeperAddress);
  });

  it("test", async () => {
    const token = await ethers.getContractAt(
      "IERC20",
      "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9"
    );

    const vault = await ethers.getContractAt(
      "RibbonThetaVault",
      "0xe63151A0Ed4e5fafdc951D877102cf0977Abd365"
    );

    const startBalance = await token.balanceOf(daoAddress);
    const { totalPending, lastLockedAmount } = await vault.vaultState();

    console.log(
      `totalBalance: ${formatEther(await token.balanceOf(vault.address))}`
    );
    console.log(`totalPending: ${formatEther(totalPending)}`);
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
