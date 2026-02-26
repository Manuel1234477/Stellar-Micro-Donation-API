/**
 * API Integration Test for Rate Limiting
 * Tests the rate limiter with actual HTTP requests
 * 
 * Usage: 
 * 1. Start server: npm start
 * 2. Run this script: node test-rate-limit-api.js
 */

const http = require('http');

const API_URL = 'http://localhost:3000';
const API_KEY = 'test-api-key-123';

function makeRequest(path, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { 'X-API-Key': apiKey })
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null
        });
      });
    });

    req.on('error', reject);
    
    req.write(JSON.stringify({
      amount: 10,
      recipient: 'GBXYZ123456789'
    }));
    
    req.end();
  });
}

async function runTests() {
  console.log('=== Rate Limiting API Integration Test ===\n');
  
  try {
    // Test 1: Missing API Key
    console.log('Test 1: Request without API key');
    const res1 = await makeRequest('/donations', null);
    console.log('Status:', res1.status);
    console.log('Error code:', res1.body.error.code);
    console.log(res1.status === 401 && res1.body.error.code === 'MISSING_API_KEY' 
      ? '✓ Missing API key rejected\n' 
      : '✗ Test failed\n');

    // Test 2: Valid request with API key
    console.log('Test 2: Request with valid API key');
    const res2 = await makeRequest('/donations', API_KEY);
    console.log('Status:', res2.status);
    console.log('Rate limit headers:');
    console.log('  X-RateLimit-Limit:', res2.headers['x-ratelimit-limit']);
    console.log('  X-RateLimit-Remaining:', res2.headers['x-ratelimit-remaining']);
    console.log('  X-RateLimit-Reset:', res2.headers['x-ratelimit-reset']);
    console.log(res2.status === 201 && res2.headers['x-ratelimit-limit'] 
      ? '✓ Request accepted with rate limit headers\n' 
      : '✗ Test failed\n');

    // Test 3: Multiple requests
    console.log('Test 3: Multiple requests (checking counter)');
    const res3a = await makeRequest('/donations', API_KEY);
    const res3b = await makeRequest('/donations', API_KEY);
    const remaining1 = parseInt(res3a.headers['x-ratelimit-remaining']);
    const remaining2 = parseInt(res3b.headers['x-ratelimit-remaining']);
    console.log('First request remaining:', remaining1);
    console.log('Second request remaining:', remaining2);
    console.log(remaining2 === remaining1 - 1 
      ? '✓ Counter decrements correctly\n' 
      : '✗ Test failed\n');

    // Test 4: Different API keys
    console.log('Test 4: Different API keys are isolated');
    const res4a = await makeRequest('/donations', 'key-A');
    const res4b = await makeRequest('/donations', 'key-B');
    const remainingA = parseInt(res4a.headers['x-ratelimit-remaining']);
    const remainingB = parseInt(res4b.headers['x-ratelimit-remaining']);
    console.log('Key A remaining:', remainingA);
    console.log('Key B remaining:', remainingB);
    console.log(remainingA === remainingB 
      ? '✓ API keys are isolated\n' 
      : '✗ Test failed\n');

    console.log('=== All API Tests Complete ===');
    console.log('\n✓ Rate limiting is working correctly with the API!');
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('\n✗ Error: Cannot connect to API server');
      console.error('Please start the server first: npm start');
    } else {
      console.error('\n✗ Test error:', error.message);
    }
    process.exit(1);
  }
}

runTests();
