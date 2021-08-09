# Ribbon v2

Ribbon v2 is the next version for Ribbon's Theta Vault product. It brings several major improvements to the vault and makes the vault operations decentralized.

v2 changes include:

- Decentralization of Theta Vault operations
- Improved capital efficiency (100% of vault funds are utilized)
- No more withdrawal fees, switching to performance fee
- Meta-Vault strategies by composing multiple Theta Vaults

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
