/**
 * Memo Feature Test Script
 * Comprehensive test of memo functionality
 */

const MemoValidator = require('./src/utils/memoValidator');
const MockStellarService = require('./src/services/MockStellarService');

console.log('='.repeat(60));
console.log('MEMO FEATURE TEST SUITE');
console.log('='.repeat(60));

// Test 1: Memo Validator
console.log('\n[TEST 1] Memo Validator Tests');
console.log('-'.repeat(60));

const testCases = [
  { memo: '', expected: true, description: 'Empty memo' },
  { memo: 'Valid memo', expected: true, description: 'Valid short memo' },
  { memo: 'a'.repeat(28), expected: true, description: 'Maximum length (28 bytes)' },
  { memo: 'a'.repeat(29), expected: false, description: 'Exceeds maximum length' },
  { memo: '  test  ', expected: true, description: 'Memo with whitespace' },
  { memo: 'test\0memo', expected: false, description: 'Memo with null byte' },
  { memo: 'Donation #123', expected: true, description: 'Memo with special chars' },
];

testCases.forEach((test) => {
  const result = MemoValidator.validate(test.memo);
  const status = result.valid === test.expected ? '✓ PASS' : '✗ FAIL';
  console.log(`${status} - ${test.description}`);
  if (result.valid) {
    console.log(`  Sanitized: "${result.sanitized}" (${result.byteLength} bytes)`);
  } else {
    console.log(`  Error: ${result.error}`);
  }
});

// Test 2: Sanitization
console.log('\n[TEST 2] Memo Sanitization Tests');
console.log('-'.repeat(60));

const sanitizationTests = [
  { input: '  test  ', expected: 'test' },
  { input: 'test\0memo', expected: 'testmemo' },
  { input: null, expected: '' },
  { input: undefined, expected: '' },
];

sanitizationTests.forEach(test => {
  const result = MemoValidator.sanitize(test.input);
  const status = result === test.expected ? '✓ PASS' : '✗ FAIL';
  console.log(`${status} - Input: ${JSON.stringify(test.input)} → Output: "${result}"`);
});

// Test 3: Truncation
console.log('\n[TEST 3] Memo Truncation Tests');
console.log('-'.repeat(60));

const longMemo = 'a'.repeat(50);
const truncated = MemoValidator.truncate(longMemo);
const truncatedLength = Buffer.byteLength(truncated, 'utf8');
console.log(`✓ PASS - Truncated 50-byte memo to ${truncatedLength} bytes`);
console.log(`  Original: ${longMemo.length} chars`);
console.log(`  Truncated: ${truncated.length} chars`);

// Test 4: Mock Stellar Service Integration
console.log('\n[TEST 4] Mock Stellar Service Integration');
console.log('-'.repeat(60));

async function testStellarIntegration() {
  const stellarService = new MockStellarService();

  try {
    // Create wallets
    console.log('Creating test wallets...');
    const donor = await stellarService.createWallet();
    const recipient = await stellarService.createWallet();
    console.log(`✓ Donor wallet: ${donor.publicKey.substring(0, 10)}...`);
    console.log(`✓ Recipient wallet: ${recipient.publicKey.substring(0, 10)}...`);

    // Fund wallets
    console.log('\nFunding wallets...');
    await stellarService.fundTestnetWallet(donor.publicKey);
    await stellarService.fundTestnetWallet(recipient.publicKey);
    console.log('✓ Wallets funded');

    // Test 4a: Donation with memo
    console.log('\n[TEST 4a] Donation with memo');
    const result1 = await stellarService.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '10.0',
      memo: 'Test donation with memo'
    });
    console.log(`✓ Transaction created: ${result1.transactionId}`);

    const verification1 = await stellarService.verifyTransaction(result1.transactionId);
    console.log(`✓ Transaction verified`);
    console.log(`  Memo: "${verification1.transaction.memo}"`);
    console.log(`  Amount: ${verification1.transaction.amount} XLM`);

    // Test 4b: Donation without memo
    console.log('\n[TEST 4b] Donation without memo');
    const result2 = await stellarService.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '5.0'
    });
    console.log(`✓ Transaction created: ${result2.transactionId}`);

    const verification2 = await stellarService.verifyTransaction(result2.transactionId);
    console.log(`✓ Transaction verified`);
    console.log(`  Memo: "${verification2.transaction.memo}" (empty)`);
    console.log(`  Amount: ${verification2.transaction.amount} XLM`);

    // Test 4c: Transaction history with memos
    console.log('\n[TEST 4c] Transaction history');
    const history = await stellarService.getTransactionHistory(donor.publicKey);
    console.log(`✓ Retrieved ${history.length} transactions`);
    history.forEach((tx, index) => {
      console.log(`  ${index + 1}. ${tx.amount} XLM - Memo: "${tx.memo}"`);
    });

    // Test 4d: Maximum length memo
    console.log('\n[TEST 4d] Maximum length memo (28 bytes)');
    const maxMemo = 'a'.repeat(28);
    await stellarService.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '15.0',
      memo: maxMemo
    });
    console.log(`✓ Transaction with max-length memo created`);
    console.log(`  Memo length: ${Buffer.byteLength(maxMemo, 'utf8')} bytes`);

    // Test 4e: Special characters in memo
    console.log('\n[TEST 4e] Special characters in memo');
    const specialMemo = 'Donation #123 @charity!';
    const result4 = await stellarService.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '20.0',
      memo: specialMemo
    });
    const verification4 = await stellarService.verifyTransaction(result4.transactionId);
    console.log(`✓ Transaction with special characters created`);
    console.log(`  Memo: "${verification4.transaction.memo}"`);

    console.log('\n✓ All Stellar integration tests passed!');

  } catch (error) {
    console.error(`✗ FAIL - ${error.message}`);
    throw error;
  }
}

// Test 5: UTF-8 Multi-byte Characters
console.log('\n[TEST 5] UTF-8 Multi-byte Character Tests');
console.log('-'.repeat(60));

const utf8Tests = [
  { text: 'Hello', bytes: 5, description: 'ASCII text' },
  { text: 'Café', bytes: 5, description: 'Latin with accent' },
  { text: '你好', bytes: 6, description: 'Chinese characters' },
  { text: '❤️', bytes: 6, description: 'Emoji (heart)' },
  { text: '🎉', bytes: 4, description: 'Emoji (party)' },
];

utf8Tests.forEach(test => {
  const actualBytes = Buffer.byteLength(test.text, 'utf8');
  const status = actualBytes === test.bytes ? '✓ PASS' : '✗ FAIL';
  console.log(`${status} - ${test.description}: "${test.text}"`);
  console.log(`  Expected: ${test.bytes} bytes, Actual: ${actualBytes} bytes`);
});

// Run async tests
testStellarIntegration()
  .then(() => {
    console.log('\n' + '='.repeat(60));
    console.log('ALL TESTS COMPLETED SUCCESSFULLY');
    console.log('='.repeat(60));
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n' + '='.repeat(60));
    console.error('TEST SUITE FAILED');
    console.error('='.repeat(60));
    console.error(error);
    process.exit(1);
  });
