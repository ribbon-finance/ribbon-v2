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
