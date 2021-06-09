const RibbonThetaVault = artifacts.require("RibbonThetaVault");
const AdminUpgradeabilityProxy = artifacts.require("AdminUpgradeabilityProxy");
const GammaProtocolLib = artifacts.require("GammaProtocol");
const { encodeCall } = require("@openzeppelin/upgrades");
const { ethers, BigNumber } = require("ethers");
const { parseEther } = ethers.utils;

const {
  updateDeployedAddresses,
} = require("../scripts/helpers/updateDeployedAddresses");
const ACCOUNTS = require("../constants/accounts.json");
const DEPLOYMENTS = require("../constants/deployments.json");
const EXTERNAL_ADDRESSES = require("../constants/externalAddresses.json");

module.exports = async function (deployer, network) {
  const networkLookup = network.replace("-fork", "");
  const { admin, owner } = ACCOUNTS[networkLookup];

  await GammaProtocolLib.deployed();

  await deployer.link(GammaProtocolLib, RibbonThetaVault);

  // Deploying the logic contract
  await deployer.deploy(
    RibbonThetaVault,
    EXTERNAL_ADDRESSES[networkLookup].assets.weth,
    EXTERNAL_ADDRESSES[networkLookup].assets.usdc,
    // _oTokenFactory
    // _gammaController
    // _marginPool
    // _gnosisEasyAuction 0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101
    // _gammaProtocol GAMMA PROTOCOL ADDR
    { from: admin }
  );
  await updateDeployedAddresses(
    network,
    "RibbonETHCoveredCallLogic",
    RibbonThetaVault.address
  );

  // Deploying the proxy contract
  const initBytes = encodeCall(
    "initialize",
    [
      "address",
      "address",
      "uint256",
      "tuple",
      "uint256",
      "address",
      "bool",
      "uint256",
      "address",
      "address",
    ],
    [
      owner,
      owner,
      parseEther("1000").toString(),
      ["Ribbon ETH Theta Vault", "rETH-THETA", 18],
      // WETH: 10**18, 10**10 0.0000001
      // WBTC: 0.000001
      BigNumber.from("10").pow(BigNumber.from("10")).toString(), // WBTC 10**3
      EXTERNAL_ADDRESSES[networkLookup].assets.weth,
      false,
      970,
      // _strikeSelection
      // _optionsPremiumPricer
    ]
  );

  await deployer.deploy(
    AdminUpgradeabilityProxy,
    RibbonThetaVault.address,
    admin,
    initBytes,
    {
      from: admin,
    }
  );

  await updateDeployedAddresses(
    network,
    "RibbonETHCoveredCall",
    AdminUpgradeabilityProxy.address
  );
};
