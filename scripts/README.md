# Deployments

## Run

Example to deploy to Mainnet:
- yarn deploy --network mainnet --tags ManualVolOracle
- yarn deploy --network mainnet --tags RibbonThetaVaultLogic
- yarn deploy --network mainnet --tags RibbonThetaVaultETHCall

## Verifications
- We can't verify the rvol contracts because they are compiled with 7.3.0.
- They should really be deploy by the rvol repo.

## To verify the rvol contracts
- I used solt, https://github.com/hjubb/solt
- In rvol repo: solt write contracts --npm
- Go to Snowtrace
- Use verification Standard Json-Input, compiler 0.7.3, GNU-v3
- Upload solc-input-contracts.json

## Staked ETH - stETH
Can't be deployed to Avax because there's no staked eth tokens.

## Submit vault proxy contracts to Etherscan/Snowtrace
- https://snowtrace.io/proxyContractChecker

## Notes
1) Change admin on vault contract. Proxy admin and owner/keeper cannot be the same address. https://snowtrace.io/tx/0x283e00885d4f06257d4cdcb8f1fce39fb9bfa3c0c9016a933e863a9f577c1b89
2) Call setAnnualizedVol in manualVolOracle (otherwise you'll get !sSQRT on commitAndClose). https://snowtrace.io/tx/0x04b367cfead099b14802285302b3a4f33eff9732a2d047362a1c3814a90aa6de
3) Call whitelistCollateral in Whitelist contract. https://snowtrace.io/tx/0x8125b100defdd06ebf856b713c0839c75a25525f7a9689c31be10e18478811bb
4) Call whitelistProduct in Whitelist contract. I used tenderly debugger to get the _underlying, _strike, _collateral, _isPut addresses. https://snowtrace.io/tx/0x930889ad93455b907b25d5983c30dc389cbb09d54677713b878d7e2e543bcd02
5) Call commitAndClose on the vault proxy. https://snowtrace.io/tx/0x2d3ce409c18914b149222a62bdc6eddbf874e5b9d9164ed52abc5fb405c15770
6) Call depositETH (will use Avax if on Avalanche). https://snowtrace.io/tx/0x31064fe47e9b1b32b1a6535eb38f022f5a0550a7be4eb9bce1353d83c65fd742
7) Wait 15 minutes
8) Call rollToNextOption. https://snowtrace.io/tx/0xdee544b975ff95d46776f489adb08a5db89848ee78a77de32d404ca010a2dea8
