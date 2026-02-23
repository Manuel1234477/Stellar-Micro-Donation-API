# Mock Stellar Service Guide

## Overview

The Mock Stellar Service provides an in-memory simulation of Stellar blockchain behavior for development and testing. It allows you to test your application without making actual network calls or spending real/testnet XLM.

## Features

### Realistic Behaviors Simulated

1. **Account Management**
   - Wallet creation with valid Stellar keypair format (G/S + 55 base32 characters)
   - Balance tracking with 7 decimal precision
   - Sequence number management
   - Account funding requirements

2. **Transaction Processing**
   - Payment transactions with proper validation
   - Transaction history tracking
   - Real-time transaction streaming
   - Transaction verification by hash

3. **Error Simulation**
   - Invalid keypair format detection
   - Insufficient balance errors
   - Unfunded account errors
   - Rate limiting (configurable)
   - Random transaction failures (configurable)
   - Network timeout simulation (configurable)
   - Duplicate funding prevention

4. **Stellar Network Rules**
   - Minimum account balance (1 XLM base reserve)
   - 7 decimal place precision for amounts
   - Maximum amount validation (922337203685.4775807 XLM)
   - Base32 alphabet for key generation
   - Transaction fees (0.0000100 XLM)

## Configuration Options

```javascript
const service = new MockStellarService({
  networkDelay: 100,        // Simulate network delays (ms)
  failureRate: 0.05,        // Random failures (0-1)
  rateLimit: 10,            // Max requests per second
  minAccountBalance: '1.0000000',
  baseReserve: '1.0000000',
  strictValidation: true,
});
```



## Limitations

### What the Mock Does NOT Simulate

1. **Blockchain Consensus** - No distributed ledger, instant confirmation
2. **Network Behavior** - No real latency, partitions, or P2P communication
3. **Advanced Features** - No multi-sig, custom assets, trustlines, path payments, DEX
4. **Transaction Complexity** - No operation batching, time bounds, or preconditions
5. **Account Features** - No flags, signers, home domain, or data entries
6. **State Management** - Memory-only storage, no persistence

## Usage Examples

### Basic Operations

```javascript
const service = new MockStellarService();

// Create and fund wallet
const wallet = await service.createWallet();
await service.fundTestnetWallet(wallet.publicKey);

// Check balance
const balance = await service.getBalance(wallet.publicKey);
console.log('Balance:', balance.balance, balance.asset);
```

### Sending Donations

```javascript
const source = await service.createWallet();
const destination = await service.createWallet();

await service.fundTestnetWallet(source.publicKey);
await service.fundTestnetWallet(destination.publicKey);

const result = await service.sendDonation({
  sourceSecret: source.secretKey,
  destinationPublic: destination.publicKey,
  amount: '100.50',
  memo: 'Donation for project',
});
```

### Transaction History & Streaming

```javascript
// Get history
const history = await service.getTransactionHistory(wallet.publicKey, 10);

// Stream transactions
const unsubscribe = service.streamTransactions(wallet.publicKey, (tx) => {
  console.log('New transaction:', tx.amount, tx.memo);
});
```

## Testing with Realistic Errors

### Network Delays

```javascript
const service = new MockStellarService({ networkDelay: 500 });
```

### Random Failures

```javascript
const service = new MockStellarService({ failureRate: 0.1 }); // 10% failure rate
```

### Rate Limiting

```javascript
const service = new MockStellarService({ rateLimit: 5 }); // 5 req/sec max
```

## Common Error Messages

**Validation Errors:**
- Invalid Stellar public/secret key format
- Amount must be greater than zero
- Amount cannot have more than 7 decimal places

**Business Logic Errors:**
- Insufficient balance (must maintain 1 XLM reserve)
- Destination account is not funded
- Account already funded (Friendbot once only)
- Rate limit exceeded

**Random Failures (when failureRate > 0):**
- tx_bad_seq: Sequence number mismatch
- tx_insufficient_balance
- tx_failed: Network congestion
- timeout: Request timeout

## Best Practices

**Development:**
- Use default config for fast iteration
- Enable delays to test loading states
- Use failure simulation for error handling

**Testing:**
- Fresh service instance per test
- Use realistic amounts (7 decimals)
- Test error paths with invalid inputs
- Verify transaction history after operations

**CI/CD:**
- Default config for speed
- Include occasional delay tests
- Test rate limiting if making many requests

## Transitioning to Real Stellar

1. Update configuration to real Horizon URLs
2. Replace Friendbot with actual funding
3. Add proper error handling for network issues
4. Implement retry logic
5. Add transaction monitoring
6. Handle sequence number conflicts
7. Implement fee management
8. Secure secret key storage

## Troubleshooting

**"Account not found"** - Create wallet first
**"Destination not funded"** - Fund destination before sending
**"Insufficient balance"** - Remember 1 XLM base reserve
**Tests are slow** - Reduce networkDelay
**Random failures** - Set failureRate to 0

## Additional Resources

- [Stellar Documentation](https://developers.stellar.org/)
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk)
- [Horizon API Reference](https://developers.stellar.org/api)
