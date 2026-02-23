# Mock Stellar Service - Test Scenarios

## Scenario 1: Happy Path - Complete Donation Flow

```javascript
test('complete donation flow', async () => {
  const service = new MockStellarService();
  
  // Create donor and recipient
  const donor = await service.createWallet();
  const recipient = await service.createWallet();
  
  // Fund both accounts
  await service.fundTestnetWallet(donor.publicKey);
  await service.fundTestnetWallet(recipient.publicKey);
  
  // Send donation
  const result = await service.sendDonation({
    sourceSecret: donor.secretKey,
    destinationPublic: recipient.publicKey,
    amount: '50.00',
    memo: 'Support for project',
  });
  
  // Verify transaction
  expect(result.transactionId).toBeDefined();
  expect(result.status).toBe('confirmed');
  
  // Check balances
  const donorBalance = await service.getBalance(donor.publicKey);
  const recipientBalance = await service.getBalance(recipient.publicKey);
  
  expect(parseFloat(donorBalance.balance)).toBe(9950.0);
  expect(parseFloat(recipientBalance.balance)).toBe(10050.0);
});
```

## Scenario 2: Error Handling - Unfunded Destination

```javascript
test('reject payment to unfunded account', async () => {
  const service = new MockStellarService();
  
  const donor = await service.createWallet();
  const recipient = await service.createWallet();
  
  // Only fund donor
  await service.fundTestnetWallet(donor.publicKey);
  
  // Attempt to send to unfunded account
  await expect(
    service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '50.00',
      memo: 'Test',
    })
  ).rejects.toThrow('Destination account is not funded');
});
```

## Scenario 3: Error Handling - Insufficient Balance

```javascript
test('reject payment exceeding balance minus reserve', async () => {
  const service = new MockStellarService();
  
  const donor = await service.createWallet();
  const recipient = await service.createWallet();
  
  await service.fundTestnetWallet(donor.publicKey);
  await service.fundTestnetWallet(recipient.publicKey);
  
  // Try to send all funds (violates 1 XLM reserve)
  await expect(
    service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '10000.00',
      memo: 'Test',
    })
  ).rejects.toThrow('Account must maintain minimum balance');
});
```

## Scenario 4: Network Simulation - Delays

```javascript
test('handle network delays gracefully', async () => {
  const service = new MockStellarService({ networkDelay: 200 });
  
  const startTime = Date.now();
  
  const wallet = await service.createWallet();
  await service.fundTestnetWallet(wallet.publicKey);
  const balance = await service.getBalance(wallet.publicKey);
  
  const endTime = Date.now();
  const totalTime = endTime - startTime;
  
  // Should take at least 600ms (3 operations × 200ms)
  expect(totalTime).toBeGreaterThanOrEqual(600);
  expect(balance.balance).toBe('10000.0000000');
});
```

## Scenario 5: Network Simulation - Random Failures

```javascript
test('retry on random failures', async () => {
  const service = new MockStellarService({ failureRate: 0.5 });
  
  const donor = await service.createWallet();
  const recipient = await service.createWallet();
  
  // Fund with retries
  let funded = false;
  let attempts = 0;
  
  while (!funded && attempts < 5) {
    try {
      await service.fundTestnetWallet(donor.publicKey);
      funded = true;
    } catch (error) {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  
  expect(funded).toBe(true);
  expect(attempts).toBeGreaterThan(0); // Should have failed at least once
});
```

## Scenario 6: Rate Limiting

```javascript
test('handle rate limiting with backoff', async () => {
  const service = new MockStellarService({ rateLimit: 3 });
  
  const wallet = await service.createWallet();
  await service.fundTestnetWallet(wallet.publicKey);
  
  const results = [];
  
  for (let i = 0; i < 5; i++) {
    try {
      const balance = await service.getBalance(wallet.publicKey);
      results.push({ success: true, balance });
    } catch (error) {
      if (error.message.includes('Rate limit')) {
        // Wait and retry
        await new Promise(resolve => setTimeout(resolve, 1000));
        const balance = await service.getBalance(wallet.publicKey);
        results.push({ success: true, balance, retried: true });
      } else {
        throw error;
      }
    }
  }
  
  expect(results.length).toBe(5);
  expect(results.some(r => r.retried)).toBe(true);
});
```

## Scenario 7: Transaction History

```javascript
test('track complete transaction history', async () => {
  const service = new MockStellarService();
  
  const donor = await service.createWallet();
  const recipient1 = await service.createWallet();
  const recipient2 = await service.createWallet();
  
  await service.fundTestnetWallet(donor.publicKey);
  await service.fundTestnetWallet(recipient1.publicKey);
  await service.fundTestnetWallet(recipient2.publicKey);
  
  // Make multiple donations
  await service.sendDonation({
    sourceSecret: donor.secretKey,
    destinationPublic: recipient1.publicKey,
    amount: '100.00',
    memo: 'First donation',
  });
  
  await service.sendDonation({
    sourceSecret: donor.secretKey,
    destinationPublic: recipient2.publicKey,
    amount: '200.00',
    memo: 'Second donation',
  });
  
  // Check donor history
  const history = await service.getTransactionHistory(donor.publicKey);
  
  expect(history.length).toBe(2);
  expect(history[0].memo).toBe('Second donation'); // Most recent first
  expect(history[1].memo).toBe('First donation');
  
  // Verify amounts
  const totalSent = history.reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
  expect(totalSent).toBe(300.0);
});
```

## Scenario 8: Real-time Streaming

```javascript
test('stream transactions in real-time', async () => {
  const service = new MockStellarService();
  
  const donor = await service.createWallet();
  const recipient = await service.createWallet();
  
  await service.fundTestnetWallet(donor.publicKey);
  await service.fundTestnetWallet(recipient.publicKey);
  
  // Set up stream listener
  const receivedTransactions = [];
  const unsubscribe = service.streamTransactions(
    recipient.publicKey,
    (tx) => receivedTransactions.push(tx)
  );
  
  // Send multiple donations
  await service.sendDonation({
    sourceSecret: donor.secretKey,
    destinationPublic: recipient.publicKey,
    amount: '50.00',
    memo: 'Donation 1',
  });
  
  await service.sendDonation({
    sourceSecret: donor.secretKey,
    destinationPublic: recipient.publicKey,
    amount: '75.00',
    memo: 'Donation 2',
  });
  
  // Verify streaming
  expect(receivedTransactions.length).toBe(2);
  expect(receivedTransactions[0].memo).toBe('Donation 1');
  expect(receivedTransactions[1].memo).toBe('Donation 2');
  
  unsubscribe();
});
```

## Scenario 9: Validation - Invalid Keys

```javascript
test('reject invalid key formats', async () => {
  const service = new MockStellarService();
  
  // Invalid public key
  await expect(
    service.getBalance('INVALID_KEY')
  ).rejects.toThrow('Invalid Stellar public key format');
  
  // Invalid secret key
  const recipient = await service.createWallet();
  await service.fundTestnetWallet(recipient.publicKey);
  
  await expect(
    service.sendDonation({
      sourceSecret: 'INVALID_SECRET',
      destinationPublic: recipient.publicKey,
      amount: '10.00',
      memo: 'Test',
    })
  ).rejects.toThrow('Invalid Stellar secret key format');
});
```

## Scenario 10: Validation - Amount Precision

```javascript
test('enforce 7 decimal place precision', async () => {
  const service = new MockStellarService();
  
  const donor = await service.createWallet();
  const recipient = await service.createWallet();
  
  await service.fundTestnetWallet(donor.publicKey);
  await service.fundTestnetWallet(recipient.publicKey);
  
  // Too many decimal places
  await expect(
    service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '10.12345678', // 8 decimals
      memo: 'Test',
    })
  ).rejects.toThrow('Amount cannot have more than 7 decimal places');
  
  // Valid precision
  const result = await service.sendDonation({
    sourceSecret: donor.secretKey,
    destinationPublic: recipient.publicKey,
    amount: '10.1234567', // 7 decimals
    memo: 'Test',
  });
  
  expect(result.transactionId).toBeDefined();
});
```

## Scenario 11: Concurrent Operations

```javascript
test('handle concurrent donations safely', async () => {
  const service = new MockStellarService();
  
  const donor1 = await service.createWallet();
  const donor2 = await service.createWallet();
  const recipient = await service.createWallet();
  
  await service.fundTestnetWallet(donor1.publicKey);
  await service.fundTestnetWallet(donor2.publicKey);
  await service.fundTestnetWallet(recipient.publicKey);
  
  // Send concurrent donations
  const results = await Promise.all([
    service.sendDonation({
      sourceSecret: donor1.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '100.00',
      memo: 'From donor 1',
    }),
    service.sendDonation({
      sourceSecret: donor2.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '200.00',
      memo: 'From donor 2',
    }),
  ]);
  
  expect(results.length).toBe(2);
  expect(results[0].transactionId).not.toBe(results[1].transactionId);
  
  // Verify final balance
  const balance = await service.getBalance(recipient.publicKey);
  expect(parseFloat(balance.balance)).toBe(10300.0); // 10000 + 100 + 200
});
```

## Scenario 12: Transaction Verification

```javascript
test('verify transaction by hash', async () => {
  const service = new MockStellarService();
  
  const donor = await service.createWallet();
  const recipient = await service.createWallet();
  
  await service.fundTestnetWallet(donor.publicKey);
  await service.fundTestnetWallet(recipient.publicKey);
  
  const result = await service.sendDonation({
    sourceSecret: donor.secretKey,
    destinationPublic: recipient.publicKey,
    amount: '50.00',
    memo: 'Verified donation',
  });
  
  // Verify transaction
  const verification = await service.verifyTransaction(result.transactionId);
  
  expect(verification.verified).toBe(true);
  expect(verification.status).toBe('confirmed');
  expect(verification.transaction.amount).toBe('50.0000000');
  expect(verification.transaction.memo).toBe('Verified donation');
  expect(verification.transaction.fee).toBe('0.0000100');
  expect(verification.transaction.sequence).toBeDefined();
});
```

## Running These Tests

Save any scenario to a test file and run:

```bash
npm test -- your-test-file.test.js
```

Or add to existing test suite:

```javascript
describe('Real-world Scenarios', () => {
  // Add scenarios here
});
```

## Tips for Writing Tests

1. **Always create fresh service instance** per test
2. **Fund both source and destination** before transactions
3. **Use realistic amounts** with proper decimal places
4. **Test both success and failure paths**
5. **Verify balances** after operations
6. **Check transaction history** for completeness
7. **Test concurrent operations** for race conditions
8. **Simulate network conditions** for robustness
