# Stellar Multi-Hop Path Payments

## Overview

Multi-hop path payments allow routing through multiple intermediate assets (up to 6) to find the best conversion rate for cross-asset donations. This feature discovers optimal payment paths through the Stellar DEX.

## Features

- **Path Discovery**: Find routes through up to 6 intermediate assets
- **Rate Sorting**: Paths sorted by effective exchange rate
- **Client Path Selection**: Allow clients to specify preferred paths
- **No-Path Handling**: Returns 422 with clear error when no path exists

## Implementation Status

This feature is in progress. The following components need to be implemented:

1. Enhanced `discoverBestPath` with `maxHops` parameter
2. New `discoverAllPaths` method returning all routes sorted by rate
3. Updated `pathPayment` to support client-specified paths
4. Proper 422 error handling for no-path scenarios
5. MockStellarService updates for multi-hop simulation

## API Usage

```javascript
// Discover all paths with max 3 hops
const paths = await stellarService.discoverAllPaths({
  sourceAsset: { type: 'native' },
  sourceAmount: '100',
  destAsset: { type: 'credit_alphanum4', code: 'USDC', issuer: '...' },
  maxHops: 3
});

// Use specific path
await stellarService.pathPayment(
  sourceAsset,
  sourceAmount,
  destAsset,
  destAmount,
  paths[0].path, // Use first (best) path
  { sourceSecret, destinationPublic, useClientPath: true }
);
```

## Testing Requirements

- Single-hop path found and used
- Multi-hop path discovered and sorted by rate
- No-path-found returns 422
- Client-specified path used when provided
- maxHops parameter validation (1-6)

## Security Considerations

- Path manipulation prevention
- Slippage tolerance validation
- Rate verification before execution
