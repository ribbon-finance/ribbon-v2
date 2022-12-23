import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { assert } from "chai";
import { BigNumber } from "ethers";
import { parseEther } from "ethers/lib/utils";
import { ethers, network } from "hardhat";
import {
  AIRSWAP_CONTRACT,
  TRADER_AFFILIATE,
  USDC_ADDRESS,
  WETH_ADDRESS,
} from "../../constants/constants";
import { signOrderForAirSwap } from "../helpers/utils";
const chainId = network.config.chainId;

describe("signing an order message", () => {
  let userSigner: SignerWithAddress;
  const counterpartyWallet = new ethers.Wallet(
    "c6cbd7d76bc5baca530c875663711b947efa6a86a900a9e8645ce32e5821484e"
  );

  before(async function () {
    [userSigner] = await ethers.getSigners();
  });

  it("signs an order message", async function () {
    const sellToken = USDC_ADDRESS[chainId];
    const buyToken = WETH_ADDRESS[chainId];
    const buyAmount = parseEther("0.1");
    const sellAmount = BigNumber.from("100000000"); // 100 USDC

    const signedOrder = await signOrderForAirSwap({
      vaultAddress: userSigner.address,
      counterpartyAddress: counterpartyWallet.address,
      signerPrivateKey: counterpartyWallet.privateKey,
      sellToken: sellToken,
      buyToken: buyToken,
      sellAmount: sellAmount.toString(),
      buyAmount: buyAmount.toString(),
    });

    const { signatory, validator } = signedOrder.signature;
    const {
      wallet: signerWallet,
      token: signerToken,
      amount: signerAmount,
    } = signedOrder.signer;
    const {
      wallet: senderWallet,
      token: senderToken,
      amount: senderAmount,
    } = signedOrder.sender;
    const { wallet: affiliate } = signedOrder.affiliate;
    assert.equal(
      ethers.utils.getAddress(signatory),
      counterpartyWallet.address
    );
    assert.equal(ethers.utils.getAddress(validator), AIRSWAP_CONTRACT[chainId]);
    assert.equal(
      ethers.utils.getAddress(signerWallet),
      counterpartyWallet.address
    );
    assert.equal(ethers.utils.getAddress(signerToken), buyToken);
    assert.equal(ethers.utils.getAddress(senderWallet), userSigner.address);
    assert.equal(ethers.utils.getAddress(senderToken), sellToken);
    assert.equal(signerAmount, buyAmount.toString());
    assert.equal(senderAmount, sellAmount.toString());
    assert.equal(
      affiliate.toLowerCase(),
      TRADER_AFFILIATE[chainId].toLowerCase()
    );
  });
});
