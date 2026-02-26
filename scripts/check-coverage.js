#!/usr/bin/env node

/**
 * Coverage Check Script
 * Validates test coverage meets minimum thresholds before commit
 */

const fs = require('fs');
const path = require('path');

const COVERAGE_FILE = path.join(__dirname, '../coverage/coverage-summary.json');
const THRESHOLDS = {
  branches: 30,
  functions: 30,
  lines: 30,
  statements: 30
};

function checkCoverage() {
  console.log('🔍 Checking test coverage...\n');

  // Check if coverage file exists
  if (!fs.existsSync(COVERAGE_FILE)) {
    console.error('❌ Coverage file not found!');
    console.error('Run: npm run test:coverage\n');
    process.exit(1);
  }

  // Read coverage data
  const coverage = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'));
  const total = coverage.total;

  // Check each metric
  const results = [];
  let allPassed = true;

  for (const [metric, threshold] of Object.entries(THRESHOLDS)) {
    const actual = total[metric].pct;
    const passed = actual >= threshold;
    
    results.push({
      metric,
      threshold,
      actual,
      passed
    });

    if (!passed) {
      allPassed = false;
    }
  }

  // Display results
  console.log('Coverage Results:');
  console.log('─'.repeat(60));
  
  results.forEach(({ metric, threshold, actual, passed }) => {
    const status = passed ? '✅' : '❌';
    const metricName = metric.padEnd(12);
    const actualStr = `${actual.toFixed(2)}%`.padStart(8);
    const thresholdStr = `${threshold}%`.padStart(8);
    
    console.log(`${status} ${metricName} ${actualStr} (min: ${thresholdStr})`);
  });

  console.log('─'.repeat(60));

  if (allPassed) {
    console.log('\n✅ All coverage thresholds met!');
    console.log('Your changes maintain code quality standards.\n');
    process.exit(0);
  } else {
    console.log('\n❌ Coverage thresholds not met!');
    console.log('Please add tests to cover your changes.\n');
    console.log('Tips:');
    console.log('  1. Run: npm run test:coverage');
    console.log('  2. Open: coverage/lcov-report/index.html');
    console.log('  3. Add tests for uncovered code');
    console.log('  4. Run this script again\n');
    process.exit(1);
  }
}

// Run the check
try {
  checkCoverage();
} catch (error) {
  console.error('❌ Error checking coverage:', error.message);
  process.exit(1);
}
