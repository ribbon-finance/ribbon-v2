import { run } from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const main = async ({
  network,
  deployments,
  getNamedAccounts,
}: HardhatRuntimeEnvironment) => {
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();
  console.log("31 - Deploying VaultDeploymentEventEmitter on", network.name);

  const existingVaultAddresses = [
    "0x8b5876f5B0Bf64056A89Aa7e97511644758c3E8c", // Normal - WBTC Calls v1
    "0x0FABaF48Bbf864a3947bdd0Ba9d764791a60467A", // Normal - ETH Calls v1
    "0x8FE74471F198E426e96bE65f40EeD1F8BA96e54f", // Normal - ETH Puts v1 (yvUSDC)
    "0x16772a7f4a3ca291C21B8AcE76F9332dDFfbb5Ef", // Normal - ETH Puts v1 (USDC)
    "0xe63151A0Ed4e5fafdc951D877102cf0977Abd365", // Normal - AAVE Covered Call V2
    "0xc0cF10Dd710aefb209D9dc67bc746510ffd98A53", // Normal - APE Covered Call V2
    "0x25751853Eab4D0eB3652B5eB6ecB102A2789644B", // Normal - ETH Covered Call V2
    "0x53773E034d9784153471813dacAFF53dBBB78E8c", // Normal - stETH Covered Call
    "0x65a833afDc250D9d38f8CD9bC2B1E3132dB13B2F", // Normal - WBTC Covered Call V2
    "0xCc323557c71C0D1D20a1861Dc69c06C5f3cC9624", // Normal - ETH Put-Selling Vault V2
    "0xA1Da0580FA96129E753D736a5901C31Df5eC5edf", // Normal - rETH Covered Call V2

    "0x84c2b16fa6877a8ff4f3271db7ea837233dfd6f0", // Earn - Ribbon USDC Earn Vault
    "0xce5513474e077f5336cf1b33c1347fdd8d48ae8c", // Earn - Ribbon stETH Earn Vault

    "0x1e2d05bd78bd50eaa380ef71f86430ed20301bf5", // Treasury - Ribbon SAMB Treasury Vault (old)
    "0x8D93ac93Bd8f6C0c1c1955f0B9Fe8508281A869C", // Treasury - Ribbon SAMB Treasury Vault (new)
    "0x270f4a26a3fe5766ccef9608718491bb057be238", // Treasury - Ribbon BADGER Treasury Vault
    "0x2a6b048eb15c7d4ddca27db4f9a454196898a0fe", // Treasury - Ribbon BAL Treasury Vault
    "0x42cf874bbe5564efcf252bc90829551f4ec639dc", // Treasury - Ribbon SPELL Treasury Vault
    "0xe44edf7ad1d434afe3397687dd0a914674f2e405", // Treasury - Ribbon PERP Treasury Vault

    "0x34B44791fc1aAAc1120994a885c9Df6CDE50ECda", // VIP - Ribbon VIP VOL Vault
    "0x5D5b71Eb15075810225c7dcD9e82ae344224e9Eb", // VIP - Ribbon USDC Earn Vault (vip)
    "0x06275be44E6F886c4E470DCF880f5Fb960d79d1c", // VIP - Ribbon wBTC Earn Vault
    "0x0dD119Bea1BF0eDc4fd9C7E96bB829eC3f5013A1", // VIP - Ribbon VIP VOL Vault Two
  ];
  const existingVaultTypes = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3,
  ];

  const vaultDeploymentEventEmitter = await deploy(
    "VaultDeploymentEventEmitter",
    {
      contract: "VaultDeploymentEventEmitter",
      from: deployer,
      args: [existingVaultAddresses, existingVaultTypes],
    }
  );

  console.log(`VaultDeploymentEventEmitter @ ${vaultDeploymentEventEmitter.address}`);

  try {
    await run("verify:verify", {
      address: vaultDeploymentEventEmitter.address,
    });
  } catch (error) {
    console.log(error);
  }
};
main.tags = ["VaultDeploymentEventEmitter"];

export default main;
