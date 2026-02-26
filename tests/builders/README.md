# Test Data Builders

Test data builders provide a fluent, readable API for creating test fixtures. They eliminate repetitive setup code and make tests more maintainable.

## Benefits

- **Reduced Boilerplate**: No more repetitive wallet creation and funding
- **Improved Readability**: Tests read like specifications
- **Easier Maintenance**: Change defaults in one place
- **Type Safety**: Consistent data structures
- **Fluent API**: Chain methods for clean, expressive code

## Available Builders

### WalletBuilder

Creates and funds Stellar wallets for tests.

```javascript
const { WalletBuilder } = require('./builders');

// Create a funded wallet
const wallet = await new WalletBuilder(stellarService).funded().build();

// Create unfunded wallet
const wallet = await new WalletBuilder(stellarService).unfunded().build();

// Create multiple funded wallets
const wallets = await new WalletBuilder(stellarService).funded().buildMany(3);

// Quick helpers
const donor = await WalletBuilder.createFundedDonor(stellarService);
const recipient = await WalletBuilder.createFundedRecipient(stellarService);

// Create donor-recipient pair (most common pattern)
const { donor, recipient } = await WalletBuilder.createDonorRecipientPair(stellarService);
```

### DonationRequestBuilder

Builds donation request payloads for API tests.

```javascript
const { DonationRequestBuilder } = require('./builders');

// Minimal donation request
const request = DonationRequestBuilder.minimal(donor, recipient);

// Complete donation with all fields
const request = DonationRequestBuilder.complete(donor, recipient, '100', 'Test memo');

// Custom donation with fluent API
const request = new DonationRequestBuilder()
  .between(donor, recipient)
  .withAmount('250.50')
  .withMemo('Coffee donation')
  .build();

// Invalid request (for error testing)
const request = DonationRequestBuilder.invalid();
```

### ApiRequestBuilder

Simplifies HTTP request setup with authentication headers.

```javascript
const { ApiRequestBuilder } = require('./builders');
const request = require('supertest');

// POST request with auto-generated idempotency key
const response = await ApiRequestBuilder
  .forDonation(request, app)
  .post('/donations', donationData);

// GET request as admin
const response = await ApiRequestBuilder
  .forAdmin(request, app, adminKey)
  .get('/api-keys');

// Custom request with specific headers
const response = await ApiRequestBuilder
  .create(request, app)
  .withApiKey('custom-key')
  .withIdempotencyKey('unique-key-123')
  .withHeader('X-Custom', 'value')
  .post('/donations', data);

// Fluent API for different roles
const response = await ApiRequestBuilder
  .create(request, app)
  .asAdmin()
  .get('/admin/endpoint');

const response = await ApiRequestBuilder
  .create(request, app)
  .asUser()
  .post('/user/endpoint', data);
```

### TransactionBuilder

Creates transaction mock data for tests.

```javascript
const { TransactionBuilder } = require('./builders');

// Quick completed transaction
const tx = TransactionBuilder.completed(donorAddress, recipientAddress, 100);

// Pending transaction
const tx = TransactionBuilder.pending(donorAddress, recipientAddress, 50);

// Custom transaction with fluent API
const tx = new TransactionBuilder()
  .withAmount(250)
  .fromWallet(donor)
  .toWallet(recipient)
  .withMemo('Test transaction')
  .completed()
  .build();

// Multiple transactions for a wallet
const transactions = TransactionBuilder.forWallet('GTEST123', 5);

// Build many with same config
const transactions = new TransactionBuilder()
  .withAmount(100)
  .completed()
  .buildMany(10);
```

### ApiKeyBuilder

Creates API keys for authentication tests.

```javascript
const { ApiKeyBuilder } = require('./builders');

// Quick admin key
const adminKey = await ApiKeyBuilder.admin('My Admin Key');

// Quick user key
const userKey = await ApiKeyBuilder.user('My User Key');

// Custom key with fluent API
const keyInfo = await new ApiKeyBuilder()
  .withName('Integration Test Key')
  .asUser()
  .expiresIn(30)
  .withMetadata({ purpose: 'testing' })
  .build();

// Create admin and user pair
const { admin, user } = await ApiKeyBuilder.createAdminUserPair();

// Cleanup after tests
const builder = new ApiKeyBuilder();
const key1 = await builder.asUser().build();
const key2 = await builder.asAdmin().build();
// ... use keys in tests ...
await builder.cleanup(); // Removes all created keys
```

### TestAppBuilder

Creates configured Express apps for integration tests.

```javascript
const { TestAppBuilder } = require('./builders');

// Quick app for donation routes
const app = TestAppBuilder.forDonationRoutes();

// Quick app for wallet routes
const app = TestAppBuilder.forWalletRoutes();

// App with all routes
const app = TestAppBuilder.withAllRoutes();

// Custom app with specific configuration
const app = new TestAppBuilder()
  .withMiddleware(customMiddleware)
  .withRoute('/custom', customRouter)
  .withErrorHandler(customErrorHandler)
  .build();
```

## Migration Examples

### Before (Repetitive)

```javascript
test('should create donation', async () => {
  const donor = await stellarService.createWallet();
  const recipient = await stellarService.createWallet();
  await stellarService.fundTestnetWallet(donor.publicKey);
  await stellarService.fundTestnetWallet(recipient.publicKey);

  const response = await request(app)
    .post('/donations')
    .set('X-API-Key', 'test-key-1')
    .set('X-Idempotency-Key', 'test-idem-001')
    .send({
      amount: '100',
      donor: donor.publicKey,
      recipient: recipient.publicKey,
      memo: 'Test donation'
    });

  expect(response.status).toBe(201);
});
```

### After (Clean)

```javascript
test('should create donation', async () => {
  const { donor, recipient } = await WalletBuilder.createDonorRecipientPair(stellarService);
  const donationData = DonationRequestBuilder.complete(donor, recipient);

  const response = await ApiRequestBuilder
    .forDonation(request, app)
    .post('/donations', donationData);

  expect(response.status).toBe(201);
});
```

## Best Practices

1. **Use Static Helpers for Common Patterns**
   ```javascript
   // Good
   const { donor, recipient } = await WalletBuilder.createDonorRecipientPair(stellarService);
   
   // Instead of
   const donor = await new WalletBuilder(stellarService).funded().build();
   const recipient = await new WalletBuilder(stellarService).funded().build();
   ```

2. **Chain Methods for Readability**
   ```javascript
   // Good
   const tx = new TransactionBuilder()
     .withAmount(100)
     .fromWallet(donor)
     .toWallet(recipient)
     .completed()
     .build();
   ```

3. **Use Builders in beforeEach for Shared Setup**
   ```javascript
   let donor, recipient;
   
   beforeEach(async () => {
     ({ donor, recipient } = await WalletBuilder.createDonorRecipientPair(stellarService));
   });
   ```

4. **Combine Builders for Complex Scenarios**
   ```javascript
   const { donor, recipient } = await WalletBuilder.createDonorRecipientPair(stellarService);
   const donationData = DonationRequestBuilder.complete(donor, recipient, '500');
   const response = await ApiRequestBuilder.forDonation(request, app).post('/donations', donationData);
   ```

## Adding New Builders

When you notice repetitive test setup:

1. Create a new builder in `tests/builders/`
2. Follow the fluent API pattern
3. Add static helpers for common use cases
4. Export from `index.js`
5. Document in this README

## Testing the Builders

Builders themselves should be simple and don't need extensive testing. However, if a builder has complex logic, add tests in `tests/builders/*.test.js`.
