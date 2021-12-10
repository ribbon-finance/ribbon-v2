# Debugging tips

### '!premium'
```
Error: VM Exception while processing transaction: reverted with reason string '!premium
```
- Update the price aggregator in ChainLinkPricer.
- You need to deploy a new ChainLinkPricer since there's no method to update the pricer.
- Run in GammaProtocol repo

```
truffle exec ./scripts/deployChainlinkPricer.js --network avax --bot 0xd4816d144c005b29df24c8eb1865fb8a1e79fdde --asset 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7 --aggregator 0x0A77230d17318075983913bC2145DB16C7366156 --oracle 0x5c76E757138379E376D1Cb9C18723f884df5e8Eb

truffle run verify --network avax ChainLinkPricer@0xAc12780B07bd623dE572c4e657195F8294869664 0xd4816d144c005b29df24c8eb1865fb8a1e79fdde 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7 0x0A77230d17318075983913bC2145DB16C7366156 0x5c76E757138379E376D1Cb9C18723f884df5e8Eb
```

- Call setAssetPricer in GammaOracle
- Check if setAnnualVol has been called for the pool in ManualVolOracle and trigger it if not
- Update the block number for the testcases in constants.ts

### 'Not commit phase'
```
Error: VM Exception while processing transaction: reverted with reason string 'Not commit phase'
```
- Make sure the block number is set during the commit phase
- Block number must be set to during the commit phase - 12pm UTC

### 'Expiry must be in the future!'
```
Error: VM Exception while processing transaction: reverted with reason string 'Expiry must be in the future!'
```
- This happens when you update the block number but a week hasn't past.
- Add an extra week for the firstOptionExpiry and secondOptionExpiry.
- You might be able to remove this in the future (in a week).
- If you recently changed the block number, check if the block was mined before or after friday.
- If it’s after friday, you need to add a week to both first and second option expiry

```
      // Create first option
      firstOptionExpiry = moment(latestTimestamp * 1000)
        .startOf("isoWeek")
        .add(chainId === CHAINID.AVAX_MAINNET ? 1 : 0, "week")  // Hack for Avax blocknumber not a week in the pas
        .day("friday")
        .hours(8)
        .minutes(0)
        .seconds(0)
        .unix();

...

      // Create second option
      secondOptionExpiry = moment(latestTimestamp * 1000)
        .startOf("isoWeek")
        .add(chainId === CHAINID.AVAX_MAINNET ? 2 : 1, "week")  // Hack for Avax blocknumber not a week in the pas
        .day("friday")
        .hours(8)
        .minutes(0)
        .seconds(0)
        .unix();
```
