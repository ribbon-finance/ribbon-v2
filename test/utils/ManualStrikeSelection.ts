import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { expect } from "chai";
import { BigNumber } from "ethereum-waffle/node_modules/ethers";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import { assert } from "../helpers/assertions";

const { getContractFactory } = ethers;

describe("ManualStrikeSelection", () => {
  let ss: Contract;
  let deployerSigner: SignerWithAddress;
  let ownerSigner: SignerWithAddress;

  before(async () => {
    [deployerSigner, ownerSigner] = await ethers.getSigners();
    const ManualStrikeSelection = await getContractFactory(
      "ManualStrikeSelection"
    );
    ss = await ManualStrikeSelection.deploy();
  });

  it("is able to transfer ownership", async () => {
    assert.equal(await ss.owner(), deployerSigner.address);
    await ss.connect(deployerSigner).transferOwnership(ownerSigner.address);
    assert.equal(await ss.owner(), ownerSigner.address);
  });

  it("sets the strike price", async () => {
    await ss.connect(ownerSigner).setStrikePrice("1000");
    const [strike, delta] = await ss.getStrikePrice(
      Math.floor(Number(new Date()) / 1000),
      false
    );
    assert.bnEqual(strike, BigNumber.from("1000"));
    assert.bnEqual(delta, BigNumber.from("1000"));
  });

  it("reverts when not owner setting strike", async () => {
    await expect(
      ss.connect(deployerSigner).setStrikePrice("100")
    ).to.be.revertedWith("Ownable: caller is not the owner");
  });
});
