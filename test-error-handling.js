/**
 * Test Stellar Error Handling
 * Verifies that Stellar SDK errors are caught and handled properly
 */

const config = require('./src/config/stellar');
const stellarService = config.getStellarService();

async function testErrorHandling() {
  console.log('Testing Stellar Error Handling\n');
  console.log('='.repeat(50));

  // Test 1: Wallet not found
  console.log('\n1. Testing wallet not found error...');
  try {
    await stellarService.getBalance('GINVALIDKEY123');
    console.log('❌ Should have thrown error');
  } catch (error) {
    console.log('✅ Error caught:', error.code, '-', error.message);
  }

  // Test 2: Create wallet and test insufficient balance
  console.log('\n2. Testing insufficient balance error...');
  try {
    const wallet1 = await stellarService.createWallet();
    const wallet2 = await stellarService.createWallet();
    
    // Try to send without funding
    await stellarService.sendDonation({
      sourceSecret: wallet1.secretKey,
      destinationPublic: wallet2.publicKey,
      amount: '10',
      memo: 'Test donation'
    });
    console.log('❌ Should have thrown error');
  } catch (error) {
    console.log('✅ Error caught:', error.code, '-', error.message);
  }

  // Test 3: Invalid destination (not funded)
  console.log('\n3. Testing destination not funded error...');
  try {
    const wallet1 = await stellarService.createWallet();
    const wallet2 = await stellarService.createWallet();
    
    // Fund source wallet
    await stellarService.fundTestnetWallet(wallet1.publicKey);
    
    // Try to send to unfunded destination
    await stellarService.sendDonation({
      sourceSecret: wallet1.secretKey,
      destinationPublic: wallet2.publicKey,
      amount: '5',
      memo: 'Test donation'
    });
    console.log('❌ Should have thrown error');
  } catch (error) {
    console.log('✅ Error caught:', error.code, '-', error.message);
  }

  // Test 4: Same sender and recipient
  console.log('\n4. Testing same sender/recipient error...');
  try {
    const wallet = await stellarService.createWallet();
    await stellarService.fundTestnetWallet(wallet.publicKey);
    
    await stellarService.sendDonation({
      sourceSecret: wallet.secretKey,
      destinationPublic: wallet.publicKey,
      amount: '5',
      memo: 'Test donation'
    });
    console.log('❌ Should have thrown error');
  } catch (error) {
    console.log('✅ Error caught:', error.code, '-', error.message);
  }

  // Test 5: Transaction not found
  console.log('\n5. Testing transaction not found error...');
  try {
    await stellarService.verifyTransaction('invalid_tx_hash');
    console.log('❌ Should have thrown error');
  } catch (error) {
    console.log('✅ Error caught:', error.code, '-', error.message);
  }

  // Test 6: Successful transaction
  console.log('\n6. Testing successful transaction...');
  try {
    const wallet1 = await stellarService.createWallet();
    const wallet2 = await stellarService.createWallet();
    
    // Fund both wallets
    await stellarService.fundTestnetWallet(wallet1.publicKey);
    await stellarService.fundTestnetWallet(wallet2.publicKey);
    
    // Send donation
    const result = await stellarService.sendDonation({
      sourceSecret: wallet1.secretKey,
      destinationPublic: wallet2.publicKey,
      amount: '5',
      memo: 'Test donation'
    });
    
    console.log('✅ Transaction successful:', result.transactionId);
    
    // Verify transaction
    const verification = await stellarService.verifyTransaction(result.transactionId);
    console.log('✅ Transaction verified:', verification.verified);
  } catch (error) {
    console.log('❌ Unexpected error:', error);
  }

  console.log('\n' + '='.repeat(50));
  console.log('Error handling tests completed!\n');
}

// Run tests
testErrorHandling().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
