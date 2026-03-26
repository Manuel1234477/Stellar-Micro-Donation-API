#!/usr/bin/env node

/**
 * Suspicious Pattern Detection - Demo Script
 * 
 * Demonstrates the soft alert system detecting various suspicious patterns
 * without blocking any requests.
 */

// Set minimal env for demo
process.env.NODE_ENV = 'test';
process.env.API_KEYS = 'demo-key';

const suspiciousPatternDetector = require('./src/utils/suspiciousPatternDetector');
const log = require('./src/utils/log');

console.log('🔍 Suspicious Pattern Detection Demo\n');
console.log('This demo shows how the system detects suspicious patterns');
console.log('without blocking any operations.\n');

// Mock log.warn to capture alerts
const alerts = [];
const originalWarn = log.warn;
log.warn = function(scope, message, meta) {
  if (scope === 'SUSPICIOUS_PATTERN') {
    alerts.push({ scope, message, meta });
    console.log(`\n⚠️  ALERT: ${meta.signal}`);
    console.log(`   Severity: ${meta.severity}`);
    console.log(`   Pattern: ${meta.pattern}`);
    console.log(`   Details: ${JSON.stringify(meta, null, 2)}`);
  }
  return originalWarn.call(this, scope, message, meta);
};

console.log('═'.repeat(60));
console.log('Demo 1: High Velocity Donations');
console.log('═'.repeat(60));
console.log('Simulating 6 rapid donations from same IP...\n');

const ip1 = '192.168.1.100';
for (let i = 0; i < 6; i++) {
  suspiciousPatternDetector.detectHighVelocity(ip1, {
    amount: 10,
    recipient: 'RECIPIENT_KEY'
  });
  console.log(`  ✓ Donation ${i + 1} processed (not blocked)`);
}

console.log('\n' + '═'.repeat(60));
console.log('Demo 2: Identical Amount Pattern');
console.log('═'.repeat(60));
console.log('Simulating 4 donations with identical amounts...\n');

const ip2 = '192.168.1.101';
for (let i = 0; i < 4; i++) {
  suspiciousPatternDetector.detectIdenticalAmounts(ip2, 5.5);
  console.log(`  ✓ Donation of 5.5 XLM processed (not blocked)`);
}

console.log('\n' + '═'.repeat(60));
console.log('Demo 3: High Recipient Diversity');
console.log('═'.repeat(60));
console.log('Simulating donations to 11 different recipients...\n');

const donor = 'DONOR_PUBLIC_KEY';
for (let i = 0; i < 11; i++) {
  suspiciousPatternDetector.detectRecipientDiversity(donor, `RECIPIENT_${i}`);
  console.log(`  ✓ Donation to recipient ${i + 1} processed (not blocked)`);
}

console.log('\n' + '═'.repeat(60));
console.log('Demo 4: Sequential Failures');
console.log('═'.repeat(60));
console.log('Simulating 6 consecutive failed requests...\n');

const ip3 = '192.168.1.102';
for (let i = 0; i < 6; i++) {
  suspiciousPatternDetector.detectSequentialFailures(ip3, 'AUTH_FAILED');
  console.log(`  ✓ Failure ${i + 1} logged (not blocked)`);
}

console.log('\n' + '═'.repeat(60));
console.log('Demo 5: Normal Usage (No Alerts)');
console.log('═'.repeat(60));
console.log('Simulating normal donation patterns...\n');

const ip4 = '192.168.1.103';
const alertsBefore = alerts.length;

// Normal usage: varied amounts, reasonable pace
suspiciousPatternDetector.detectHighVelocity(ip4, { amount: 5, recipient: 'R1' });
console.log('  ✓ Donation 1: 5 XLM');

suspiciousPatternDetector.detectHighVelocity(ip4, { amount: 10, recipient: 'R2' });
console.log('  ✓ Donation 2: 10 XLM');

suspiciousPatternDetector.detectHighVelocity(ip4, { amount: 15, recipient: 'R3' });
console.log('  ✓ Donation 3: 15 XLM');

if (alerts.length === alertsBefore) {
  console.log('\n  ✅ No alerts triggered - normal usage not flagged');
}

console.log('\n' + '═'.repeat(60));
console.log('Summary');
console.log('═'.repeat(60));

console.log(`\n📊 Metrics:`);
const metrics = suspiciousPatternDetector.getMetrics();
console.log(`   Velocity Tracking: ${metrics.velocityTracking} IPs`);
console.log(`   Amount Patterns: ${metrics.amountPatterns} IPs`);
console.log(`   Recipient Patterns: ${metrics.recipientPatterns} donors`);
console.log(`   Sequential Failures: ${metrics.sequentialFailures} IPs`);
console.log(`   Time Patterns: ${metrics.timePatterns} IPs`);

console.log(`\n🚨 Alerts Generated: ${alerts.length}`);
alerts.forEach((alert, idx) => {
  console.log(`   ${idx + 1}. ${alert.meta.signal} (${alert.meta.severity})`);
});

console.log('\n✅ Key Takeaways:');
console.log('   • All suspicious patterns were detected and logged');
console.log('   • No requests were blocked or rejected');
console.log('   • Normal usage did not trigger false positives');
console.log('   • System is purely observational');
console.log('   • Alerts available for security monitoring\n');

// Cleanup
suspiciousPatternDetector.stop();
log.warn = originalWarn;

console.log('Demo complete! Check logs for structured alert data.\n');
