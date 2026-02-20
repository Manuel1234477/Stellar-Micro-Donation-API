const Database = require('./src/utils/database');

async function testWalletTransactions() {
  console.log('Testing Wallet Transactions Endpoint Logic\n');

  try {
    // Test 1: Get transactions for user 1 (has sent transactions)
    console.log('Test 1: User with transactions (sender)');
    const publicKey1 = 'GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJMUC5XNODMZTQYBB5XYZXYUU';
    
    const user1 = await Database.get(
      'SELECT id, publicKey, createdAt FROM users WHERE publicKey = ?',
      [publicKey1]
    );
    console.log('User found:', user1);

    const transactions1 = await Database.query(
      `SELECT 
        t.id,
        t.senderId,
        t.receiverId,
        t.amount,
        t.memo,
        t.timestamp,
        sender.publicKey as senderPublicKey,
        receiver.publicKey as receiverPublicKey
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      LEFT JOIN users receiver ON t.receiverId = receiver.id
      WHERE t.senderId = ? OR t.receiverId = ?
      ORDER BY t.timestamp DESC`,
      [user1.id, user1.id]
    );

    console.log('Transactions:', JSON.stringify(transactions1, null, 2));
    console.log(`Count: ${transactions1.length}\n`);

    // Test 2: Get transactions for user 3 (receiver)
    console.log('Test 2: User with transactions (receiver)');
    const publicKey3 = 'GCZST3XVCDTUJ76ZAV2HA72KYQM4YQQ5DUJTHIGQ5ESE3JNEZUAEUA7X';
    
    const user3 = await Database.get(
      'SELECT id, publicKey, createdAt FROM users WHERE publicKey = ?',
      [publicKey3]
    );
    console.log('User found:', user3);

    const transactions3 = await Database.query(
      `SELECT 
        t.id,
        t.senderId,
        t.receiverId,
        t.amount,
        t.memo,
        t.timestamp,
        sender.publicKey as senderPublicKey,
        receiver.publicKey as receiverPublicKey
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      LEFT JOIN users receiver ON t.receiverId = receiver.id
      WHERE t.senderId = ? OR t.receiverId = ?
      ORDER BY t.timestamp DESC`,
      [user3.id, user3.id]
    );

    console.log('Transactions:', JSON.stringify(transactions3, null, 2));
    console.log(`Count: ${transactions3.length}\n`);

    // Test 3: Non-existent wallet
    console.log('Test 3: Non-existent wallet');
    const fakePublicKey = 'GFAKEWALLETADDRESSNOTINDB123456789012345678901234567890';
    
    const userFake = await Database.get(
      'SELECT id, publicKey, createdAt FROM users WHERE publicKey = ?',
      [fakePublicKey]
    );
    console.log('User found:', userFake);
    console.log('Should return empty array\n');

    console.log('✓ All tests completed successfully!');
  } catch (error) {
    console.error('✗ Test failed:', error.message);
    process.exit(1);
  }
}

testWalletTransactions();
