/**
 * Test script to demonstrate sensitive data masking
 * Run: node test-sensitive-masking.js
 */

const log = require('./src/utils/log');
const { maskSensitiveData } = require('./src/utils/dataMasker');

console.log('='.repeat(80));
console.log('SENSITIVE DATA MASKING DEMONSTRATION');
console.log('='.repeat(80));
console.log();

// Example 1: Donation Request
console.log('Example 1: Donation Request');
console.log('-'.repeat(80));
const donationRequest = {
  amount: '100.50',
  destination: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
  senderSecret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
  memo: 'Donation for charity'
};

console.log('BEFORE MASKING:');
console.log(JSON.stringify(donationRequest, null, 2));
console.log();

const maskedDonation = maskSensitiveData(donationRequest);
console.log('AFTER MASKING:');
console.log(JSON.stringify(maskedDonation, null, 2));
console.log();

// Example 2: API Headers
console.log('Example 2: API Headers');
console.log('-'.repeat(80));
const headers = {
  'content-type': 'application/json',
  'user-agent': 'Test Client/1.0',
  'x-api-key': 'sk_live_abc123xyz789',
  'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.test'
};

console.log('BEFORE MASKING:');
console.log(JSON.stringify(headers, null, 2));
console.log();

const maskedHeaders = maskSensitiveData(headers);
console.log('AFTER MASKING:');
console.log(JSON.stringify(maskedHeaders, null, 2));
console.log();

// Example 3: User Authentication
console.log('Example 3: User Authentication');
console.log('-'.repeat(80));
const authData = {
  username: 'john.doe',
  email: 'john@example.com',
  password: 'SuperSecret123!',
  apiKey: 'ak_prod_1234567890abcdef',
  profile: {
    name: 'John Doe',
    role: 'admin'
  }
};

console.log('BEFORE MASKING:');
console.log(JSON.stringify(authData, null, 2));
console.log();

const maskedAuth = maskSensitiveData(authData);
console.log('AFTER MASKING:');
console.log(JSON.stringify(maskedAuth, null, 2));
console.log();

// Example 4: Using Log Utility
console.log('Example 4: Log Utility (Automatic Masking)');
console.log('-'.repeat(80));
console.log('Logging with sensitive data...');
console.log();

log.info('DEMO', 'User login attempt', {
  username: 'john.doe',
  password: 'secret123',
  timestamp: new Date().toISOString()
});

log.info('DEMO', 'Processing donation', {
  amount: '100',
  destination: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
  senderSecret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ'
});

log.error('DEMO', 'Authentication failed', {
  apiKey: 'secret-key-123',
  error: 'Invalid credentials',
  attemptCount: 3
});

console.log();

// Example 5: Nested Objects
console.log('Example 5: Nested Objects with Arrays');
console.log('-'.repeat(80));
const complexData = {
  transaction: {
    id: 'tx_123',
    amount: '50.00',
    sender: {
      publicKey: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
      secretKey: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ'
    },
    recipients: [
      { address: 'GBZV...1', amount: '25.00' },
      { address: 'GBZV...2', amount: '25.00' }
    ]
  },
  metadata: {
    apiKey: 'key123',
    timestamp: Date.now()
  }
};

console.log('BEFORE MASKING:');
console.log(JSON.stringify(complexData, null, 2));
console.log();

const maskedComplex = maskSensitiveData(complexData);
console.log('AFTER MASKING:');
console.log(JSON.stringify(maskedComplex, null, 2));
console.log();

// Example 6: Partial Masking (for debugging)
console.log('Example 6: Partial Masking (Debug Mode)');
console.log('-'.repeat(80));
const sensitiveData = {
  apiKey: 'sk_live_1234567890abcdef',
  token: 'tok_test_9876543210zyxwvu'
};

console.log('FULL REDACTION (Production):');
const fullyMasked = maskSensitiveData(sensitiveData);
console.log(JSON.stringify(fullyMasked, null, 2));
console.log();

console.log('PARTIAL MASKING (Development):');
const partiallyMasked = maskSensitiveData(sensitiveData, { showPartial: true });
console.log(JSON.stringify(partiallyMasked, null, 2));
console.log();

console.log('='.repeat(80));
console.log('DEMONSTRATION COMPLETE');
console.log('='.repeat(80));
console.log();
console.log('Key Observations:');
console.log('✅ Passwords, secrets, and API keys are masked');
console.log('✅ Stellar secret keys (starting with S) are masked');
console.log('✅ Public keys (starting with G) are preserved');
console.log('✅ Non-sensitive data (amounts, IDs, timestamps) is preserved');
console.log('✅ Nested objects and arrays are handled correctly');
console.log('✅ Debug usefulness is maintained');
console.log();
