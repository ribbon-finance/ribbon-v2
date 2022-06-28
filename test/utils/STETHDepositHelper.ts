import { ethers, network } from "hardhat";
import { BigNumber, Contract, utils } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "../helpers/assertions";
import {
  BLOCK_NUMBER,
  CHAINID,
  STETH_ADDRESS,
  STETH_ETH_CRV_POOL,
} from "../../constants/constants";

import CurveETHSTETHPoolAbi from "../../constants/abis/CurveETHSTETHPool.json";
import RibbonThetaVaultLogic from "../../deployments/mainnet/RibbonThetaVaultLogic.json";
import RibbonThetaVaultSTETHCall from "../../deployments/mainnet/RibbonThetaVaultSTETHCall.json";

describe("STETHDepositHelper", () => {
  let stETHDepositHelper: Contract;
  let stETH: Contract;
  let stETHVault: Contract;
  let curveETHSTETHPool: Contract;
  let signer: SignerWithAddress;

  const amountAfterSlippage = (
    num: BigNumber,
    slippage: number, // this is a float
    decimals: number = 18
  ) => {
    if (slippage >= 1.0) {
      throw new Error("Slippage cannot exceed 100%");
    }
    const discountValue = ethers.utils
      .parseUnits("1", decimals)
      .sub(ethers.utils.parseUnits(slippage.toFixed(3), decimals));
    return num.mul(discountValue).div(BigNumber.from(10).pow(decimals));
  };

  before(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.TEST_URI,
            blockNumber: BLOCK_NUMBER[CHAINID.ETH_MAINNET],
          },
        },
      ],
    });

    [signer] = await ethers.getSigners();

    const STETHDepositHelper = await ethers.getContractFactory(
      "STETHDepositHelper"
    );
    stETHDepositHelper = await STETHDepositHelper.connect(signer).deploy(
      STETH_ETH_CRV_POOL,
      RibbonThetaVaultSTETHCall.address,
      STETH_ADDRESS
    );

    curveETHSTETHPool = await ethers.getContractAt(
      CurveETHSTETHPoolAbi,
      STETH_ETH_CRV_POOL
    );

    stETH = await ethers.getContractAt("ISTETH", STETH_ADDRESS);

    stETHVault = await ethers.getContractAt(
      RibbonThetaVaultLogic.abi,
      RibbonThetaVaultSTETHCall.address
    );
  });

  it("Swaps ETH to stETH and deposits stETH into vault", async () => {
    const AMOUNT_INDEX = 1;
    assert.equal(
      (await stETHVault.depositReceipts(signer.address))[
        AMOUNT_INDEX
      ].toString(),
      "0"
    );
    const startBalance = await stETH.balanceOf(stETHVault.address);

    // DEPOSITING 1 ETH -> stETH vault
    // 1. Find the minSTETHAmount using 0.05% slippage
    const depositAmount = utils.parseEther("1");
    const slippage = 0.005;
    const exchangeSTETHAmount = await curveETHSTETHPool.get_dy(
      0,
      1,
      depositAmount,
      {
        gasLimit: 400000,
      }
    );
    const minSTETHAmount = amountAfterSlippage(depositAmount, slippage);

    console.log(
      depositAmount.toString(),
      exchangeSTETHAmount.toString(),
      minSTETHAmount.toString()
    );
    // 1000000000000000000;
    // 950000000000000000;
    // 949132737090134212;

    const tx = await stETHDepositHelper.deposit(minSTETHAmount, { value: depositAmount });
    console.log(tx);

    // assert.equal(
    //   (await stETHVault.depositReceipts(signer.address))[
    //     AMOUNT_INDEX
    //   ].toString(),
    //   "259480652035615045"
    // );
    const endBalance = await stETH.balanceOf(stETHVault.address);

    assert.isAbove(endBalance, startBalance);
  });
});
