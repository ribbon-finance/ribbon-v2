# Debugging tips

### Error !premium
```
Error: VM Exception while processing transaction: reverted with reason string '!premium
```
- Update the price aggregator in ChainLinkPricer.
- You need to deploy a new ChainLinkPricer since there's no method to update the pricer.
- Run in GammaProtocol repo
- truffle exec ./scripts/deployChainlinkPricer.js --network avax --bot 0xd4816d144c005b29df24c8eb1865fb8a1e79fdde --asset 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7 --aggregator 0x0A77230d17318075983913bC2145DB16C7366156 --oracle 0x5c76E757138379E376D1Cb9C18723f884df5e8Eb
- truffle run verify --network avax ChainLinkPricer@0xAc12780B07bd623dE572c4e657195F8294869664 0xd4816d144c005b29df24c8eb1865fb8a1e79fdde 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7 0x0A77230d17318075983913bC2145DB16C7366156 0x5c76E757138379E376D1Cb9C18723f884df5e8Eb
- Call setAssetPricer in GammaOracle
- Check if setAnnualVol has been called for the pool in ManualVolOracle and trigger it if not
- Update the block number for the testcases in constants.ts - Block number must be set to the commit phase - 12pm UTC
