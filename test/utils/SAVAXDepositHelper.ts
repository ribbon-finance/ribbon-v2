import { ethers, network } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "../helpers/assertions";
import {
  BLOCK_NUMBER,
  CHAINID,
  SAVAX_ADDRESS,
} from "../../constants/constants";

import StakedAvaxAbi from "../../constants/abis/StakedAvax.json";
import AvaxRibbonThetaVaultLogic from "../../deployments/avax/RibbonThetaVaultLogic.json";
import RibbonThetaVaultSAVAXCall from "../../deployments/avax/RibbonThetaVaultSAVAXCall.json";

describe("SAVAXDepositHelper", () => {
  let sAVAXDepositHelper: Contract;
  let sAVAXVault: Contract;
  let sAVAX: Contract;
  let signer: SignerWithAddress;

  beforeEach(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.AVAX_URI,
            blockNumber: BLOCK_NUMBER[CHAINID.AVAX_MAINNET],
          },
        },
      ],
    });

    [signer] = await ethers.getSigners();

    sAVAX = await ethers.getContractAt(
      StakedAvaxAbi,
      SAVAX_ADDRESS[CHAINID.AVAX_MAINNET]
    );

    const SAVAXDepositHelper = await ethers.getContractFactory(
      "SAVAXDepositHelper"
    );
    sAVAXDepositHelper = await SAVAXDepositHelper.connect(signer).deploy(
      SAVAX_ADDRESS[CHAINID.AVAX_MAINNET],
      RibbonThetaVaultSAVAXCall.address
    );

    sAVAXVault = await ethers.getContractAt(
      AvaxRibbonThetaVaultLogic.abi,
      RibbonThetaVaultSAVAXCall.address
    );
  });

  it("Stakes AVAX and deposits sAVAX into vault", async () => {
    const AMOUNT_INDEX = 1;
    assert.equal(
      (await sAVAXVault.depositReceipts(signer.address))[
        AMOUNT_INDEX
      ].toString(),
      "0"
    );
    const startBalance = await sAVAX.balanceOf(sAVAXVault.address);

    await sAVAXDepositHelper.deposit({ value: ethers.utils.parseEther(".26") });

    assert.equal(
      (await sAVAXVault.depositReceipts(signer.address))[
        AMOUNT_INDEX
      ].toString(),
      "258855101807555732"
    );
    const endBalance = await sAVAX.balanceOf(sAVAXVault.address);
    assert.isAbove(endBalance, startBalance);
  });

  it("Stakes AVAX and 'deposits for' sAVAX into vault", async () => {
    const AMOUNT_INDEX = 1;
    assert.equal(
      (await sAVAXVault.depositReceipts(signer.address))[
        AMOUNT_INDEX
      ].toString(),
      "0"
    );
    const startBalance = await sAVAX.balanceOf(sAVAXVault.address);

    await sAVAXDepositHelper.depositFor(signer.address, {
      value: ethers.utils.parseEther(".26"),
    });

    assert.equal(
      (await sAVAXVault.depositReceipts(signer.address))[
        AMOUNT_INDEX
      ].toString(),
      "258855101807555732"
    );
    const endBalance = await sAVAX.balanceOf(sAVAXVault.address);
    assert.isAbove(endBalance, startBalance);
  });
});
