import hre, { ethers, artifacts } from "hardhat";
import { increaseTo } from "./time";
import WBTC_ABI from "../../constants/abis/WBTC.json";
import ORACLE_ABI from "../../constants/abis/OpynOracle.json";
import {
  GAMMA_ORACLE,
  GAMMA_ORACLE_STETH,
  GAMMA_WHITELIST,
  ORACLE_DISPUTE_PERIOD,
  ORACLE_LOCKING_PERIOD,
  ORACLE_OWNER,
  USDC_ADDRESS,
} from "../../constants/constants";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { BigNumber, BigNumberish, Contract } from "ethers";
import { wmul } from "../helpers/math";

const { provider } = ethers;
const { parseEther } = ethers.utils;

export async function deployProxy(
  logicContractName: string,
  adminSigner: SignerWithAddress,
  initializeArgs: any[],
  logicDeployParams = [],
  factoryOptions = {}
) {
  const AdminUpgradeabilityProxy = await ethers.getContractFactory(
    "AdminUpgradeabilityProxy",
    adminSigner
  );
  const LogicContract = await ethers.getContractFactory(
    logicContractName,
    factoryOptions || {}
  );
  const logic = await LogicContract.deploy(...logicDeployParams);

  const initBytes = LogicContract.interface.encodeFunctionData(
    "initialize",
    initializeArgs
  );

  const proxy = await AdminUpgradeabilityProxy.deploy(
    logic.address,
    await adminSigner.getAddress(),
    initBytes
  );
  return await ethers.getContractAt(logicContractName, proxy.address);
}

export async function parseLog(
  contractName: string,
  log: { topics: string[]; data: string }
) {
  if (typeof contractName !== "string") {
    throw new Error("contractName must be string");
  }
  const abi = (await artifacts.readArtifact(contractName)).abi;
  const iface = new ethers.utils.Interface(abi);
  const event = iface.parseLog(log);
  return event;
}

export async function mintAndApprove(
  tokenAddress: string,
  userSigner: SignerWithAddress,
  spender: string,
  amount: BigNumber
) {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: ["0xca06411bd7a7296d7dbdd0050dfc846e95febeb7"],
  });
  const wbtcMinter = await ethers.provider.getSigner(
    "0xca06411bd7a7296d7dbdd0050dfc846e95febeb7"
  );
  const forceSendContract = await ethers.getContractFactory("ForceSend");
  const forceSend = await forceSendContract.deploy(); // force Send is a contract that forces the sending of Ether to WBTC minter (which is a contract with no receive() function)
  await forceSend.deployed();
  await forceSend.go("0xca06411bd7a7296d7dbdd0050dfc846e95febeb7", {
    value: parseEther("1"),
  });

  const WBTCToken = await ethers.getContractAt(WBTC_ABI, tokenAddress);
  await WBTCToken.connect(wbtcMinter).mint(userSigner.address, amount);
  await WBTCToken.connect(userSigner).approve(
    spender,
    amount.mul(BigNumber.from("10"))
  );
}

export async function getAssetPricer(
  pricer: string,
  signer: SignerWithAddress
) {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [pricer],
  });

  const ownerSigner = await provider.getSigner(pricer);

  const pricerContract = await ethers.getContractAt("IYearnPricer", pricer);

  const forceSendContract = await ethers.getContractFactory("ForceSend");
  const forceSend = await forceSendContract.deploy(); // force Send is a contract that forces the sending of Ether to WBTC minter (which is a contract with no receive() function)
  await forceSend.connect(signer).go(pricer, { value: parseEther("0.5") });

  return await pricerContract.connect(ownerSigner);
}

export async function setAssetPricer(
  asset: string,
  pricer: string,
  isSTETH = false
) {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [ORACLE_OWNER],
  });

  const ownerSigner = await provider.getSigner(ORACLE_OWNER);

  const oracle = await ethers.getContractAt(
    "IOracle",
    isSTETH ? GAMMA_ORACLE_STETH : GAMMA_ORACLE
  );

  await oracle.connect(ownerSigner).setAssetPricer(asset, pricer);
}

export async function whitelistProduct(
  underlying: string,
  strike: string,
  collateral: string,
  isPut: boolean
) {
  const [adminSigner] = await ethers.getSigners();

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [ORACLE_OWNER],
  });

  const ownerSigner = await provider.getSigner(ORACLE_OWNER);

  const whitelist = await ethers.getContractAt(
    "IGammaWhitelist",
    GAMMA_WHITELIST
  );

  await adminSigner.sendTransaction({
    to: ORACLE_OWNER,
    value: parseEther("0.5"),
  });

  await whitelist.connect(ownerSigner).whitelistCollateral(collateral);

  await whitelist
    .connect(ownerSigner)
    .whitelistProduct(underlying, strike, collateral, isPut);
}

export async function setupOracle(
  pricerOwner: string,
  signer: SignerWithAddress,
  isSTETH = false
) {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [pricerOwner],
  });
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [ORACLE_OWNER],
  });
  const pricerSigner = await provider.getSigner(pricerOwner);

  const forceSendContract = await ethers.getContractFactory("ForceSend");
  const forceSend = await forceSendContract.deploy(); // force Send is a contract that forces the sending of Ether to WBTC minter (which is a contract with no receive() function)
  await forceSend.connect(signer).go(pricerOwner, { value: parseEther("0.5") });

  const oracle = new ethers.Contract(
    isSTETH ? GAMMA_ORACLE_STETH : GAMMA_ORACLE,
    ORACLE_ABI,
    pricerSigner
  );

  const oracleOwnerSigner = await provider.getSigner(ORACLE_OWNER);

  await signer.sendTransaction({
    to: ORACLE_OWNER,
    value: parseEther("0.5"),
  });

  await oracle
    .connect(oracleOwnerSigner)
    .setStablePrice(USDC_ADDRESS, "100000000");

  return oracle;
}

export async function setOpynOracleExpiryPrice(
  asset: string,
  oracle: Contract,
  expiry: BigNumber,
  settlePrice: BigNumber
) {
  await increaseTo(expiry.toNumber() + ORACLE_LOCKING_PERIOD + 1);

  const res = await oracle.setExpiryPrice(asset, expiry, settlePrice);
  const receipt = await res.wait();
  const timestamp = (await provider.getBlock(receipt.blockNumber)).timestamp;

  await increaseTo(timestamp + ORACLE_DISPUTE_PERIOD + 1);
}

export async function setOpynOracleExpiryPriceYearn(
  underlyingAsset: string,
  underlyingOracle: Contract,
  underlyingSettlePrice: BigNumber,
  collateralPricer: Contract,
  expiry: BigNumber
) {
  await increaseTo(expiry.toNumber() + ORACLE_LOCKING_PERIOD + 1);

  const res = await underlyingOracle.setExpiryPrice(
    underlyingAsset,
    expiry,
    underlyingSettlePrice
  );
  await res.wait();
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [ORACLE_OWNER],
  });
  const oracleOwnerSigner = await provider.getSigner(ORACLE_OWNER);
  const res2 = await collateralPricer
    .connect(oracleOwnerSigner)
    .setExpiryPriceInOracle(expiry);
  const receipt = await res2.wait();

  const timestamp = (await provider.getBlock(receipt.blockNumber)).timestamp;
  await increaseTo(timestamp + ORACLE_DISPUTE_PERIOD + 1);
}

export async function mintToken(
  contract: Contract,
  contractOwner: string,
  recipient: string,
  spender: string,
  amount: BigNumberish
) {
  const tokenOwnerSigner = await ethers.provider.getSigner(contractOwner);

  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [contractOwner],
  });

  const forceSendContract = await ethers.getContractFactory("ForceSend");
  const forceSend = await forceSendContract.deploy(); // Some contract do not have receive(), so we force send
  await forceSend.deployed();
  await forceSend.go(contractOwner, {
    value: parseEther("0.5"),
  });

  if (contract.address == USDC_ADDRESS) {
    await contract.connect(tokenOwnerSigner).transfer(recipient, amount);
  } else {
    await contract.connect(tokenOwnerSigner).mint(recipient, amount);
  }

  const recipientSigner = await ethers.provider.getSigner(recipient);
  await contract.connect(recipientSigner).approve(spender, amount);

  await hre.network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [contractOwner],
  });
}

export async function bidForOToken(
  gnosisAuction: Contract,
  optionsPremiumPricer: Contract,
  assetContract: Contract,
  contractSigner: string,
  oToken: string,
  premium: BigNumber,
  assetDecimals: number,
  multiplier: string,
  auctionDuration: number
) {
  const userSigner = await ethers.provider.getSigner(contractSigner);

  const latestAuction = (await gnosisAuction.auctionCounter()).toString();
  const totalOptionsAvailableToBuy = BigNumber.from(
    await (
      await ethers.getContractAt("IERC20", oToken)
    ).balanceOf(gnosisAuction.address)
  )
    .mul(await gnosisAuction.FEE_DENOMINATOR())
    .div(
      (await gnosisAuction.FEE_DENOMINATOR()).add(
        await gnosisAuction.feeNumerator()
      )
    )
    .div(multiplier);

  const bid = wmul(
    totalOptionsAvailableToBuy.mul(BigNumber.from(10).pow(10)),
    premium
  )
    .div(BigNumber.from(10).pow(18 - assetDecimals))
    .toString();

  const queueStartElement =
    "0x0000000000000000000000000000000000000000000000000000000000000001";

  await assetContract.connect(userSigner).approve(gnosisAuction.address, bid);

  // BID OTOKENS HERE
  await gnosisAuction
    .connect(userSigner)
    .placeSellOrders(
      latestAuction,
      [totalOptionsAvailableToBuy.toString()],
      [bid],
      [queueStartElement],
      "0x"
    );

  await increaseTo(
    (await provider.getBlock("latest")).timestamp + auctionDuration
  );

  return [latestAuction, totalOptionsAvailableToBuy, bid];
}

export async function closeAuctionAndClaim(
  gnosisAuction: Contract,
  thetaVault: Contract,
  vault: Contract,
  signer: string
) {
  const userSigner = await ethers.provider.getSigner(signer);
  await gnosisAuction
    .connect(userSigner)
    .settleAuction(await thetaVault.optionAuctionID());
  await vault.claimAuctionOtokens();
}

export interface Order {
  sellAmount: BigNumber;
  buyAmount: BigNumber;
  userId: BigNumber;
}

export function decodeOrder(bytes: string): Order {
  return {
    userId: BigNumber.from("0x" + bytes.substring(2, 18)),
    sellAmount: BigNumber.from("0x" + bytes.substring(43, 66)),
    buyAmount: BigNumber.from("0x" + bytes.substring(19, 42)),
  };
}

export function encodeOrder(order: Order): string {
  return (
    "0x" +
    order.userId.toHexString().slice(2).padStart(16, "0") +
    order.buyAmount.toHexString().slice(2).padStart(24, "0") +
    order.sellAmount.toHexString().slice(2).padStart(24, "0")
  );
}
