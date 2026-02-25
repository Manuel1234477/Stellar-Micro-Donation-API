# Mock Stellar Service - Quick Reference

## Configuration

```javascript
const MockStellarService = require('./src/services/MockStellarService');

// Default (fast, no errors)
const service = new MockStellarService();

// Realistic (with delays and occasional failures)
const service = new MockStellarService({
  networkDelay: 100,    // 100ms per operation
  failureRate: 0.05,    // 5% failure rate
  rateLimit: 10,        // 10 req/sec max
});
```

## Common Operations

```javascript
// Create wallet
const wallet = await service.createWallet();
// Returns: { publicKey: 'G...', secretKey: 'S...' }

// Fund wallet (testnet)
await service.fundTestnetWallet(wallet.publicKey);
// Adds 10000 XLM

// Check balance
const balance = await service.getBalance(wallet.publicKey);
// Returns: { balance: '10000.0000000', asset: 'XLM' }

// Send donation
const result = await service.sendDonation({
  sourceSecret: source.secretKey,
  destinationPublic: dest.publicKey,
  amount: '100.50',
  memo: 'Thank you!',
});
// Returns: { transactionId, ledger, status, confirmedAt }

// Get history
const history = await service.getTransactionHistory(publicKey, 10);
// Returns: Array of transactions

// Stream transactions
const unsubscribe = service.streamTransactions(publicKey, (tx) => {
  console.log('New transaction:', tx);
});
```

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Invalid Stellar public key format` | Wrong key format | Use G + 55 chars |
| `Account not found` | Wallet doesn't exist | Create wallet first |
| `Destination account is not funded` | Dest has 0 balance | Fund destination |
| `Insufficient balance` | Below reserve | Keep 1 XLM minimum |
| `Rate limit exceeded` | Too many requests | Wait 1 second |
| `Account is already funded` | Friendbot used twice | Can only fund once |

## Key Formats

- **Public Key**: `G` + 55 base32 characters (A-Z, 2-7)
- **Secret Key**: `S` + 55 base32 characters (A-Z, 2-7)
- **Amount**: Up to 7 decimal places (e.g., `100.5000000`)
- **Max Amount**: `922337203685.4775807` XLM

## Important Rules

1. **Base Reserve**: Accounts must keep ≥1 XLM
2. **Funded Destination**: Recipient must have ≥1 XLM before receiving
3. **Precision**: Amounts limited to 7 decimal places
4. **Friendbot**: Can only fund each account once
5. **Same Account**: Cannot send to yourself

## Testing Patterns

```javascript
// Test with delays
const service = new MockStellarService({ networkDelay: 500 });

// Test error handling
const service = new MockStellarService({ failureRate: 0.2 });

// Test rate limiting
const service = new MockStellarService({ rateLimit: 5 });

// Clean between tests
beforeEach(() => {
  service = new MockStellarService();
});
```

## Limitations

❌ No multi-signature
❌ No custom assets
❌ No trustlines
❌ No DEX features
❌ No persistence (memory only)
❌ No real network calls

✅ Perfect for unit tests
✅ Fast development iteration
✅ Realistic error simulation
✅ No testnet XLM needed

## See Also

- `MOCK_STELLAR_GUIDE.md` - Full documentation
- `MOCK_STELLAR_ENHANCEMENTS.md` - Recent changes
- `tests/MockStellarService.test.js` - Usage examples
