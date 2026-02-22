/**
 * Test script for analytics fee calculation
 * Run with: node test-analytics-fee.js
 */

const { calculateAnalyticsFee } = require('./src/utils/feeCalculator');

console.log('Testing Analytics Fee Calculator\n');
console.log('='.repeat(50));

// Test cases
const testCases = [
  { amount: 50, description: 'Small donation' },
  { amount: 100, description: 'Medium donation' },
  { amount: 200, description: 'Large donation' },
  { amount: 0.25, description: 'Micro donation (below minimum)' },
  { amount: 1000, description: 'Very large donation' }
];

testCases.forEach(test => {
  try {
    const result = calculateAnalyticsFee(test.amount);
    console.log(`\n${test.description}:`);
    console.log(`  Original Amount: $${result.originalAmount}`);
    console.log(`  Analytics Fee: $${result.fee} (${result.feePercentage * 100}%)`);
    console.log(`  Total with Fee: $${result.totalWithFee}`);
  } catch (error) {
    console.error(`Error with ${test.description}:`, error.message);
  }
});

console.log('\n' + '='.repeat(50));
console.log('\nNote: Fees are calculated but NOT deducted on-chain');
console.log('They are stored in the database for analytics purposes only.\n');
