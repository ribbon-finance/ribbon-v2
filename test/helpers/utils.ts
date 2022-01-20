import hre, { ethers, artifacts } from "hardhat";
import { increaseTo } from "./time";
import WBTC_ABI from "../../constants/abis/WBTC.json";
import ORACLE_ABI from "../../constants/abis/OpynOracle.json";
import CHAINLINK_PRICER_ABI from "../../constants/abis/ChainLinkPricer.json";
import {
  CHAINID,
  GAMMA_ORACLE,
  GAMMA_ORACLE_NEW,
  GAMMA_WHITELIST,
  ORACLE_DISPUTE_PERIOD,
  ORACLE_LOCKING_PERIOD,
  ORACLE_OWNER,
  USDC_ADDRESS,
  WBTC_ADDRESS,
} from "../../constants/constants";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signers";
import { BigNumber, BigNumberish, Contract } from "ethers";
import { wmul } from "../helpers/math";

const { provider } = ethers;
const { parseEther } = ethers.utils;
const chainId = hre.network.config.chainId;

export async function deployProxy(
  logicContractName: string,
  adminSigner: SignerWithAddress,
  initializeArgs: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
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
    params: [ORACLE_OWNER[chainId]],
  });

  const ownerSigner = await provider.getSigner(ORACLE_OWNER[chainId]);

  const oracle = await ethers.getContractAt(
    "IOracle",
    isSTETH ? GAMMA_ORACLE_NEW[chainId] : GAMMA_ORACLE[chainId]
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
    params: [ORACLE_OWNER[chainId]],
  });

  const ownerSigner = await provider.getSigner(ORACLE_OWNER[chainId]);

  const whitelist = await ethers.getContractAt(
    "IGammaWhitelist",
    GAMMA_WHITELIST[chainId]
  );

  await adminSigner.sendTransaction({
    to: ORACLE_OWNER[chainId],
    value: parseEther("1"),
  });

  await whitelist.connect(ownerSigner).whitelistCollateral(collateral);

  await whitelist
    .connect(ownerSigner)
    .whitelistProduct(underlying, strike, collateral, isPut);
}

export async function setupOracle(
  chainlinkPricer: string,
  signer: SignerWithAddress,
  useNew = false
) {
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [chainlinkPricer],
  });
  await hre.network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [ORACLE_OWNER[chainId]],
  });
  const pricerSigner = await provider.getSigner(chainlinkPricer);

  const forceSendContract = await ethers.getContractFactory("ForceSend");
  const forceSend = await forceSendContract.deploy(); // force Send is a contract that forces the sending of Ether to WBTC minter (which is a contract with no receive() function)
  await forceSend
    .connect(signer)
    .go(chainlinkPricer, { value: parseEther("0.5") });

  const oracle = new ethers.Contract(
    useNew ? GAMMA_ORACLE_NEW[chainId] : GAMMA_ORACLE[chainId],
    ORACLE_ABI,
    pricerSigner
  );

  const oracleOwnerSigner = await provider.getSigner(ORACLE_OWNER[chainId]);

  await signer.sendTransaction({
    to: ORACLE_OWNER[chainId],
    value: parseEther("0.5"),
  });

  await oracle
    .connect(oracleOwnerSigner)
    .setStablePrice(USDC_ADDRESS[chainId], "100000000");

  const pricer = new ethers.Contract(
    chainlinkPricer,
    CHAINLINK_PRICER_ABI,
    oracleOwnerSigner
  );

  await oracle
    .connect(oracleOwnerSigner)
    .setAssetPricer(await pricer.asset(), chainlinkPricer);

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
    params: [ORACLE_OWNER[chainId]],
  });
  const oracleOwnerSigner = await provider.getSigner(ORACLE_OWNER[chainId]);
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

  if (isBridgeToken(chainId, contract.address)) {
    // Avax mainnet uses BridgeTokens which have a special mint function
    const txid = ethers.utils.formatBytes32String("Hello World!");
    await contract
      .connect(tokenOwnerSigner)
      .mint(recipient, amount, recipient, 0, txid);
  } else if (
    contract.address === USDC_ADDRESS[chainId] ||
    chainId === CHAINID.AURORA_MAINNET
  ) {
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

export const isBridgeToken = (chainId: number, address: string) =>
  chainId === CHAINID.AVAX_MAINNET &&
  (address === WBTC_ADDRESS[chainId] || address === USDC_ADDRESS[chainId]);

export async function bidForOToken(
  gnosisAuction: Contract,
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

  let bid = wmul(
    totalOptionsAvailableToBuy.mul(BigNumber.from(10).pow(10)),
    premium
  );
  bid = assetDecimals > 18 ? bid.mul(BigNumber.from(10).pow(assetDecimals - 18)) : bid.div(BigNumber.from(10).pow(18 - assetDecimals));

  const queueStartElement =
    "0x0000000000000000000000000000000000000000000000000000000000000001";

  await assetContract.connect(userSigner).approve(gnosisAuction.address, bid.toString());

  // BID OTOKENS HERE
  await gnosisAuction
    .connect(userSigner)
    .placeSellOrders(
      latestAuction,
      [totalOptionsAvailableToBuy.toString()],
      [bid.toString()],
      [queueStartElement],
      "0x"
    );

  await increaseTo(
    (await provider.getBlock("latest")).timestamp + auctionDuration
  );

  return [latestAuction, totalOptionsAvailableToBuy, bid];
}

export async function lockedBalanceForRollover(vault: Contract) {
  let currentBalance = await vault.totalBalance();
  let newPricePerShare = await vault.pricePerShare();

  let queuedWithdrawAmount = await sharesToAsset(
    (
      await vault.vaultState()
    ).queuedWithdrawShares,
    newPricePerShare,
    (
      await vault.vaultParams()
    ).decimals
  );

  let balanceSansQueued = currentBalance.sub(queuedWithdrawAmount);
  return [balanceSansQueued, queuedWithdrawAmount];
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

async function sharesToAsset(
  shares: BigNumber,
  assetPerShare: BigNumber,
  decimals: BigNumber
) {
  return shares
    .mul(assetPerShare)
    .div(BigNumber.from(10).pow(decimals.toString()));
}

export function encodePath(tokenAddresses, fees) {
  // Encode path for Uniswap swap path
  const FEE_SIZE = 3;

  if (tokenAddresses.length !== fees.length + 1) {
    throw new Error("path/fee lengths do not match");
  }

  let encoded = "0x";
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += tokenAddresses[i].slice(2);
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, "0");
  }
  // encode the final token
  encoded += tokenAddresses[tokenAddresses.length - 1].slice(2);

  return encoded.toLowerCase();
}

/* eslint @typescript-eslint/no-explicit-any: "off" */
export const objectEquals = (a: any, b: any) => {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date)
    return a.getTime() === b.getTime();
  if (!a || !b || (typeof a !== "object" && typeof b !== "object"))
    return a === b;
  /* eslint no-undefined: "off" */
  if (a === null || a === undefined || b === null || b === undefined)
    return false;
  if (a.prototype !== b.prototype) return false;
  let keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => objectEquals(a[k], b[k]));
};

export const serializeMap = (map: Record<string, unknown>) => {
  return Object.fromEntries(
    Object.keys(map).map((key) => {
      return [key, serializeToObject(map[key])];
    })
  );
};

export const serializeToObject = (solidityValue: unknown) => {
  if (BigNumber.isBigNumber(solidityValue)) {
    return solidityValue.toString();
  }
  // Handle structs recursively
  if (Array.isArray(solidityValue)) {
    return solidityValue.map((val) => serializeToObject(val));
  }
  return solidityValue;
};

export const getDeltaStep = (asset: string) => {
  switch (asset) {
    case "WBTC":
      return BigNumber.from("1000");
    case "AAVE":
      return BigNumber.from("10");
    case "NEAR":
    case "AURORA":
      return BigNumber.from("5");
    case "SUSHI":
      return BigNumber.from("1");
    case "WETH":
      if (chainId === CHAINID.AVAX_MAINNET) {
        return BigNumber.from("5");
      }
      return BigNumber.from("100");
    default:
      throw new Error(`Delta Step not found for asset: ${asset}`);
  }
};
