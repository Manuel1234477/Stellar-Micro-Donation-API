const axios = require('axios');
const Database = require('../src/utils/database');

// Configuration
const API_URL = 'http://localhost:3000/api/v1'; // Standardized prefix used in some parts
const BASE_URL = 'http://localhost:3000';

async function verifySendDonation() {
    console.log('--- Verifying POST /donations/send ---\n');

    try {
        // 1. Get sample users
        const users = await Database.query('SELECT * FROM users LIMIT 2');
        if (users.length < 2) {
            console.error('Not enough users in DB to perform test.');
            return;
        }

        const sender = users[0];
        const receiver = users[1];

        console.log(`Sender: ${sender.publicKey} (ID: ${sender.id})`);
        console.log(`Receiver: ${receiver.publicKey} (ID: ${receiver.id})`);

        // 2. Prepare request
        // Note: We need a real secret key for the sender if using testnet.
        // For local verification, we can enable MOCK_STELLAR=true in .env
        const amount = '10.5';
        const memo = 'Test donation';

        console.log('\nSending donation request...');

        // Attempting to send using the MockStellarService by ensuring MOCK_STELLAR is true
        // or providing a dummy secret if it's mock.
        const response = await axios.post(`${BASE_URL}/donations/send`, {
            senderId: sender.id,
            receiverId: receiver.id,
            amount: amount,
            memo: memo
        }).catch(err => {
            console.error('Request failed:', err.response ? err.response.data : err.message);
            throw err;
        });

        console.log('Response Status:', response.status);
        console.log('Response Data:', JSON.stringify(response.data, null, 2));

        if (response.status === 201 && response.data.success) {
            console.log('\n✓ Donation sent successfully on Stellar!');

            // 3. Verify Database Recording (SQLite)
            const tx = await Database.get(
                'SELECT * FROM transactions WHERE senderId = ? AND receiverId = ? ORDER BY timestamp DESC LIMIT 1',
                [sender.id, receiver.id]
            );

            if (tx && tx.amount == amount) {
                console.log('✓ Transaction recorded in SQLite database.');
            } else {
                console.log('✗ Transaction NOT found in SQLite database.');
            }

            // 4. Verify JSON Recording
            const TransactionModel = require('../src/routes/models/transaction');
            const allJsonTxs = TransactionModel.getAll();
            const jsonTx = allJsonTxs.find(t => t.amount == amount && t.donor === sender.publicKey);

            if (jsonTx) {
                console.log('✓ Transaction recorded in JSON model (for stats).');
            } else {
                console.log('✗ Transaction NOT found in JSON model.');
            }

        } else {
            console.log('✗ Donation failed.');
        }

    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.error('Server is not running. Please start it with "npm run dev" or "npm start"');
        } else {
            console.error('Verification failed:', error.message);
        }
    }
}

verifySendDonation();
