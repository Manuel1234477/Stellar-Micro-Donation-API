const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function runEdgeCases() {
    console.log('--- Running Edge Case Tests ---\n');

    // Test 1: Missing Required Fields
    console.log('Test 1: Missing Fields');
    try {
        const res = await axios.post(`${BASE_URL}/donations/send`, {
            senderId: 1
        });
    } catch (err) {
        console.log(`✓ Caught expected error: ${err.response.data.error}\n`);
    }

    // Test 2: Invalid Amount
    console.log('Test 2: Invalid Amount');
    try {
        const res = await axios.post(`${BASE_URL}/donations/send`, {
            senderId: 1,
            receiverId: 2,
            amount: -10
        });
    } catch (err) {
        console.log(`✓ Caught expected error: ${err.response.data.error}\n`);
    }

    // Test 3: Non-existent User
    console.log('Test 3: Non-existent User');
    try {
        const res = await axios.post(`${BASE_URL}/donations/send`, {
            senderId: 999,
            receiverId: 2,
            amount: 10
        });
    } catch (err) {
        console.log(`✓ Caught expected error: ${err.response.data.error}\n`);
    }

    // Test 4: Verify Endpoint
    console.log('Test 4: Verify Endpoint (Valid Hash)');
    try {
        // First, get a real hash from the previous test if possible, 
        // but we can just use a fake one since it's mock
        const res = await axios.post(`${BASE_URL}/donations/verify`, {
            transactionHash: 'mock_tx_hash_123'
        });
        console.log(`✓ Verification response: ${res.data.success ? 'Success' : 'Failure'}`);
        console.log(`  Data: ${JSON.stringify(res.data.data)}\n`);
    } catch (err) {
        console.error('✗ Verify endpoint failed:', err.message);
    }

    console.log('--- Edge Case Testing Complete ---');
}

runEdgeCases();
