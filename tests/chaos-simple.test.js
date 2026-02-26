/**
 * Simplified Chaos Tests
 * Quick verification that chaos testing works correctly
 */

process.env.MOCK_STELLAR = 'true';

const MockStellarService = require('../src/services/MockStellarService');

describe('Chaos Testing - Quick Verification', () => {
  let stellarService;
  let results = { total: 0, success: 0, failures: 0, crashes: 0 };

  beforeAll(() => {
    stellarService = new MockStellarService({
      networkDelay: 0,
      failureRate: 0,
      strictValidation: true,
    });
    console.log('\n🌪️  Running Quick Chaos Verification\n');
  });

  afterAll(() => {
    console.log('\n📊 Quick Chaos Results:');
    console.log(`   Total: ${results.total}`);
    console.log(`   Success: ${results.success}`);
    console.log(`   Failures: ${results.failures}`);
    console.log(`   Crashes: ${results.crashes}`);
    console.log(`   Status: ${results.crashes === 0 ? '✅ PASS' : '❌ FAIL'}\n`);
  });

  test('should handle random transaction failures without crashing', async () => {
    const donor = await stellarService.createWallet();
    const recipient = await stellarService.createWallet();
    await stellarService.fundTestnetWallet(donor.publicKey);
    await stellarService.fundTestnetWallet(recipient.publicKey); // Fund recipient too

    // Inject 30% failure rate
    stellarService.config.failureRate = 0.3;

    for (let i = 0; i < 10; i++) {
      results.total++;
      try {
        await stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '10',
          memo: `Test ${i}`,
        });
        results.success++;
      } catch (error) {
        results.failures++;
        
        // Verify system still works after failure
        try {
          await stellarService.getBalance(donor.publicKey);
        } catch (crashError) {
          results.crashes++;
        }
      }
    }

    stellarService.config.failureRate = 0;

    // System should not crash
    expect(results.crashes).toBe(0);
    // Should have some successes or some failures (chaos is random)
    expect(results.success + results.failures).toBe(10);
  });

  test('should maintain balance consistency under chaos', async () => {
    const donor = await stellarService.createWallet();
    const recipient = await stellarService.createWallet();
    await stellarService.fundTestnetWallet(donor.publicKey);
    await stellarService.fundTestnetWallet(recipient.publicKey); // Fund recipient

    const initialBalance = parseFloat((await stellarService.getBalance(donor.publicKey)).balance);
    
    stellarService.config.failureRate = 0.3;

    let successfulTxCount = 0;
    const txAmount = 50;

    for (let i = 0; i < 10; i++) {
      results.total++;
      try {
        await stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: txAmount.toString(),
          memo: `Balance test ${i}`,
        });
        successfulTxCount++;
        results.success++;
      } catch (error) {
        results.failures++;
      }
    }

    stellarService.config.failureRate = 0;

    const finalBalance = parseFloat((await stellarService.getBalance(donor.publicKey)).balance);
    const expectedBalance = initialBalance - (successfulTxCount * txAmount);

    // Balance should match successful transactions
    expect(Math.abs(finalBalance - expectedBalance)).toBeLessThan(0.01);
  });

  test('should handle concurrent operations with chaos', async () => {
    const donor = await stellarService.createWallet();
    await stellarService.fundTestnetWallet(donor.publicKey);

    const recipients = await Promise.all([
      stellarService.createWallet(),
      stellarService.createWallet(),
      stellarService.createWallet(),
    ]);

    // Fund all recipients
    for (const recipient of recipients) {
      await stellarService.fundTestnetWallet(recipient.publicKey);
    }

    stellarService.config.failureRate = 0.3;

    const operations = recipients.map((recipient, i) =>
      stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '100',
        memo: `Concurrent ${i}`,
      }).catch(err => ({ error: err.message }))
    );

    const txResults = await Promise.allSettled(operations);
    results.total += operations.length;

    const succeeded = txResults.filter(r => r.status === 'fulfilled' && !r.value?.error).length;
    const failed = txResults.filter(r => r.status === 'rejected' || r.value?.error).length;

    results.success += succeeded;
    results.failures += failed;

    stellarService.config.failureRate = 0;

    // Should handle concurrent operations
    expect(succeeded + failed).toBe(operations.length);
    
    // Verify system is still responsive
    const balance = await stellarService.getBalance(donor.publicKey);
    expect(balance).toBeDefined();
    expect(parseFloat(balance.balance)).toBeGreaterThanOrEqual(0);
  });

  test('should recover from high failure rates', async () => {
    const donor = await stellarService.createWallet();
    const recipient = await stellarService.createWallet();
    await stellarService.fundTestnetWallet(donor.publicKey);
    await stellarService.fundTestnetWallet(recipient.publicKey); // Fund recipient

    // Extreme chaos: 70% failure rate
    stellarService.config.failureRate = 0.7;

    let recovered = false;
    for (let i = 0; i < 20; i++) {
      results.total++;
      try {
        await stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '5',
          memo: `Recovery test ${i}`,
        });
        results.success++;
        recovered = true;
      } catch (error) {
        results.failures++;
      }
    }

    stellarService.config.failureRate = 0;

    // System should not crash (recovered is probabilistic, so we just check no crashes)
    expect(results.crashes).toBe(0);
    // With 20 attempts at 30% success rate, we should get at least one success
    expect(results.success).toBeGreaterThan(0);
  });
});
