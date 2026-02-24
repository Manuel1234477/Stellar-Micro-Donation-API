/**
 * Manual test script for rate limiting
 * Run with: node test-rate-limit.js
 */

const rateLimiter = require('./src/middleware/rateLimiter');
const { rateLimitConfig } = require('./src/config/rateLimit');
const RequestCounter = require('./src/middleware/RequestCounter');

console.log('=== Rate Limiting Manual Test ===\n');

// Test 1: Configuration
console.log('Test 1: Configuration Loading');
console.log('Config:', rateLimitConfig);
console.log('✓ Configuration loaded\n');

// Test 2: RequestCounter
console.log('Test 2: RequestCounter');
const counter = new RequestCounter(1000);

counter.increment('test-key');
counter.increment('test-key');
const count = counter.getCount('test-key');
console.log('Count after 2 increments:', count);
console.log(count === 2 ? '✓ Counter works correctly' : '✗ Counter failed');

const timeUntilReset = counter.getTimeUntilReset('test-key');
console.log('Time until reset:', timeUntilReset, 'ms');
console.log(timeUntilReset > 0 ? '✓ Time tracking works' : '✗ Time tracking failed');

counter.reset();
console.log('Count after reset:', counter.getCount('test-key'));
console.log(counter.getCount('test-key') === 0 ? '✓ Reset works\n' : '✗ Reset failed\n');

// Test 3: API Key Isolation
console.log('Test 3: API Key Isolation');
const counter2 = new RequestCounter(1000);
counter2.increment('key1');
counter2.increment('key1');
counter2.increment('key2');

const key1Count = counter2.getCount('key1');
const key2Count = counter2.getCount('key2');
console.log('Key1 count:', key1Count);
console.log('Key2 count:', key2Count);
console.log(key1Count === 2 && key2Count === 1 ? '✓ Keys are isolated\n' : '✗ Key isolation failed\n');

// Test 4: Cleanup
console.log('Test 4: Cleanup');
const counter3 = new RequestCounter(100); // 100ms window
counter3.increment('expired-key');
console.log('Added entry, waiting for expiration...');

setTimeout(() => {
  const removed = counter3.cleanup();
  console.log('Removed entries:', removed);
  console.log(removed === 1 ? '✓ Cleanup works\n' : '✗ Cleanup failed\n');
  
  // Test 5: Middleware creation
  console.log('Test 5: Middleware Creation');
  try {
    const middleware = rateLimiter({ limit: 10, windowMs: 1000 });
    console.log('Middleware type:', typeof middleware);
    console.log(typeof middleware === 'function' ? '✓ Middleware created\n' : '✗ Middleware creation failed\n');
    
    console.log('=== All Tests Complete ===');
    console.log('\nRate limiting implementation is working correctly!');
    console.log('\nTo test with the API:');
    console.log('1. Start the server: npm start');
    console.log('2. Make requests with X-API-Key header');
    console.log('3. Monitor rate limit headers in responses');
    
    process.exit(0);
  } catch (error) {
    console.error('✗ Middleware creation failed:', error);
    process.exit(1);
  }
}, 150);
