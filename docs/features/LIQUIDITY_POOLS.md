# Stellar Liquidity Pool Deposits (#411)

## Overview
Exposes Stellar AMM liquidity pool deposit, withdrawal, and earnings tracking via REST endpoints.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/liquidity-pools/deposit` | Deposit assets into a pool |
| POST | `/liquidity-pools/withdraw` | Withdraw assets from a pool |
| GET | `/liquidity-pools/:id/earnings` | Get pool earnings |

## Request Bodies

### Deposit
```json
{ "secret": "S...", "assetA": {"type":"native"}, "assetB": {"type":"credit_alphanum4","code":"USDC","issuer":"G..."}, "maxAmountA": "100", "maxAmountB": "50" }
```

### Withdraw
```json
{ "secret": "S...", "poolId": "mock_pool_...", "amount": "70.7106781" }
```

## Atomicity
Deposits are atomic — if validation or balance checks fail, no funds are deducted.

## MockStellarService
`depositLiquidityPool`, `withdrawLiquidityPool`, and `getLiquidityPoolEarnings` are implemented in `MockStellarService` for testing without a live network.

## Tests
`tests/liquidity-pools.test.js` — 18 tests covering deposit, withdrawal, earnings, atomicity, and error cases.
