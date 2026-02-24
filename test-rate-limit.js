/**
 * Simple test script to verify rate limiting functionality
 * Tests that donation endpoints properly enforce rate limits
 * 
 * Usage: node test-rate-limit.js
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';

// Helper function to make HTTP POST request
function makeRequest(path, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-API-Key': 'test-api-key',
        'Idempotency-Key': `test-${Date.now()}-${Math.random()}`
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

// Test rate limiting on donation creation endpoint
async function testDonationRateLimit() {
  console.log('Testing Rate Limiting on POST /donations');
  console.log('Expected: First 10 requests succeed, 11th request gets 429\n');

  const testData = {
    amount: 10,
    recipient: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    donor: 'Anonymous'
  };

  let successCount = 0;
  let rateLimitedCount = 0;

  for (let i = 1; i <= 12; i++) {
    try {
      const response = await makeRequest('/donations', testData);
      
      console.log(`Request ${i}: Status ${response.statusCode}`);
      
      if (response.statusCode === 201 || response.statusCode === 200) {
        successCount++;
        console.log(`  ✓ Success`);
      } else if (response.statusCode === 429) {
        rateLimitedCount++;
        const body = JSON.parse(response.body);
        console.log(`  ✗ Rate Limited: ${body.error.message}`);
        console.log(`  Rate Limit Headers:`);
        console.log(`    - Limit: ${response.headers['ratelimit-limit']}`);
        console.log(`    - Remaining: ${response.headers['ratelimit-remaining']}`);
        console.log(`    - Reset: ${response.headers['ratelimit-reset']}`);
      } else {
        console.log(`  ? Unexpected status: ${response.statusCode}`);
        console.log(`  Body: ${response.body}`);
      }
      
      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Request ${i} failed:`, error.message);
    }
  }

  console.log('\n--- Test Summary ---');
  console.log(`Successful requests: ${successCount}`);
  console.log(`Rate limited requests: ${rateLimitedCount}`);
  
  if (successCount === 10 && rateLimitedCount === 2) {
    console.log('✓ Rate limiting is working correctly!');
  } else {
    console.log('✗ Rate limiting may not be configured correctly');
    console.log('  Expected: 10 successful, 2 rate limited');
  }
}

// Test verification endpoint rate limit (should be more lenient)
async function testVerificationRateLimit() {
  console.log('\n\nTesting Rate Limiting on POST /donations/verify');
  console.log('Expected: First 30 requests succeed, 31st request gets 429\n');

  const testData = {
    transactionHash: 'test-hash-' + Date.now()
  };

  let successCount = 0;
  let rateLimitedCount = 0;
  let errorCount = 0;

  // Test first 32 requests
  for (let i = 1; i <= 32; i++) {
    try {
      const response = await makeRequest('/donations/verify', testData);
      
      if (i === 1 || i === 30 || i === 31 || i === 32) {
        console.log(`Request ${i}: Status ${response.statusCode}`);
      } else if (i === 2) {
        console.log('... (requests 2-29) ...');
      }
      
      if (response.statusCode === 200 || response.statusCode === 500) {
        // 500 is expected since we're using fake data
        successCount++;
      } else if (response.statusCode === 429) {
        rateLimitedCount++;
        if (i >= 31) {
          const body = JSON.parse(response.body);
          console.log(`  ✗ Rate Limited: ${body.error.message}`);
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      errorCount++;
    }
  }

  console.log('\n--- Test Summary ---');
  console.log(`Successful requests: ${successCount}`);
  console.log(`Rate limited requests: ${rateLimitedCount}`);
  
  if (successCount === 30 && rateLimitedCount === 2) {
    console.log('✓ Verification rate limiting is working correctly!');
  } else {
    console.log('✗ Verification rate limiting may not be configured correctly');
    console.log('  Expected: 30 successful, 2 rate limited');
  }
}

// Run tests
async function runTests() {
  console.log('='.repeat(60));
  console.log('Rate Limiting Test Suite');
  console.log('='.repeat(60));
  console.log('\nMake sure the API server is running on http://localhost:3000\n');
  
  try {
    await testDonationRateLimit();
    
    // Wait for rate limit to reset
    console.log('\n\nWaiting 60 seconds for rate limit to reset...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    
    await testVerificationRateLimit();
    
    console.log('\n' + '='.repeat(60));
    console.log('Tests completed!');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\nTest suite failed:', error);
  }
}

// Check if server is running before starting tests
http.get('http://localhost:3000/health', (res) => {
  if (res.statusCode === 200) {
    runTests();
  } else {
    console.error('Server is not responding correctly. Please start the API server first.');
  }
}).on('error', (error) => {
  console.error('Cannot connect to server. Please start the API server first:');
  console.error('  npm start');
  process.exit(1);
});
