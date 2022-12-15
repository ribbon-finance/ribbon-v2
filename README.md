# Ribbon v2

Ribbon v2 is the next version for Ribbon's Theta Vault product. It brings several major improvements to the vault and makes the vault operations decentralized.

v2 changes include:

- Decentralization of Theta Vault operations
- Improved capital efficiency (100% of vault funds are utilized)
- No more withdrawal fees, switching to performance fee
- Meta-Vault strategies by composing multiple Theta Vaults

## Getting Started

First, install the dependencies with yarn:

```bash
yarn install
```

Next, we need to populate the .env file with these values.\
Copy the .env.example -> .env and fill out the value.\
Reach out to the team if you need help on these variables. The `TEST_URI` needs to be an archive node.

```bash
TEST_URI=
MAINNET_URI=
KOVAN_URI=
ETHERSCAN_API_KEY=
KOVAN_MNEMONIC=
MAINNET_MNEMONIC=
AVAX_URI=https://api.avax.network/ext/bc/C/rpc
FUJI_URI=https://mainnet.infura.io/v3/0bccea5795074895bdb92c62c5c3afba
AVAX_MNEMONIC=
FUJI_MNEMONIC=
```

Finally, we can run the tests:

```bash
# Run all the tests
yarn test

# Run specific test that matches the pattern -g
yarn run ts-mocha test/RibbonThetaYearnVault.ts --timeout 500000 -g 'rollToNextOption'
```

## Deployment

Ribbon v2 uses [hardhat-deploy](https://github.com/wighawag/hardhat-deploy) to manage contract deployments to the blockchain.

To deploy all the contracts to Kovan, do

```
yarn deploy --network kovan
```

The deployment info is stored on disk and committed into Git. Next, we have to export out the deployed addresses in a parseable format for the frontend to use (JSON).

```
yarn export-deployments
```

Finally, we can verify the contracts on Etherscan:

```
yarn etherscan-verify --network kovan
```

## Testing

Will run all tests on Ethereum mainnet and a subset of tests on Avax

```
yarn test
```

Runs Ethereum mainnet

```
yarn test:eth
```

Runs Avax testnet

```
yarn test:avax
```

## Treasury
<u>BAL (0x2a6B048eB15C7d4ddCa27db4f9A454196898A0Fe)</u>
<u>PERP (0xe44eDF7aD1D434Afe3397687DD0A914674F2E405)</u>
<u>SPELL (0x42cf874bBe5564EfCF252bC90829551f4ec639DC)</u>
<u>BADGER (0x270F4a26a3fE5766CcEF9608718491bb057Be238)</u>
<u>SAMB (0x1e2D05BD78bD50Eaa380Ef71F86430ED20301bF5)</u>

1. RibbonTreasuryVault [0xc92e6b70eb6456171d32c3b5904386c05ec983ff](https://etherscan.io/address/0xc92e6b70eb6456171d32c3b5904386c05ec983ff#code). This is the basic implementation and is currently used for PERP and BADGER. It uses `VaultLifecycleTreasury` at 0xcbd9a79caa0d354c9119039f5004dbcf23489c9a.
2. RibbonTreasuryVault [0x1f2077b0a9efb0c6568396a115272401fa7d95f4](https://etherscan.io/address/0x1f2077b0a9efb0c6568396a115272401fa7d95f4#code). This is the edited implementation and differs from the above based on the differences described below. Used by BAL and SPELL. It uses `VaultLifecycleTreasury` at 0xe1d00f9bafea5aa40a2192af12b68af3d390afe2.

a. RibbonTreasuryVault.sol. 0x1f has the following additional function:
`setCurrentOtokenPremium`

b. Comment on Vault.sol line 61.
0x1f: `// Total amount of queued withdrawal shares from previous rounds (doesn't include the current round)`
 vs
0xc9: `// Amount locked for scheduled withdrawals;`

c. IRibbonThetaVault.sol. 0x1f has the following additional function signatures:
`function depositFor(uint256 amount, address creditor) external;`
`function initiateWithdraw(uint256 numShares) external;`
`function completeWithdraw() external;`
`function maxRedeem() external;`
`function depositYieldTokenFor(uint256 amount, address creditor) external;`
`function symbol() external view returns (string calldata);`

In addition, the two different`VaultLifecycleTreasury` for each implementation differs in ways **b** and **c** as described above.

3. RibbonTreasuryVault [0x2e56d6e444ab148ec1375be108313aa759dfd248](https://etherscan.io/address/0x2e56d6e444ab148ec1375be108313aa759dfd248#code). This is the another edited implementation from basic implementation **1**. It is deprecated and only used by SAMB. It uses `VaultLifecycleTreasuryBare` at 0xB4a1b54141cE6C70b40527CeBd6F00fF70d94eEf. 
