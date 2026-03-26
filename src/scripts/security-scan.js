/**
 * @fileoverview Utility script to run security scans (npm audit, eslint-plugin-security, etc.)
 * programmatically, allowing for CI/CD integration and testability.
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

/**
 * Runs npm audit to check for vulnerabilities.
 * @returns {Promise<{success: boolean, output: string}>} The result of the audit.
 */
async function runNpmAudit() {
  try {
    const { stdout } = await execAsync('npm audit --audit-level=high');
    return { success: true, output: stdout };
  } catch (error) {
    return { success: false, output: error.stdout || error.message };
  }
}

/**
 * Runs SAST using eslint-plugin-security via the existing lint:security script.
 * @returns {Promise<{success: boolean, output: string}>} The result of the SAST scan.
 */
async function runSast() {
  try {
    const { stdout } = await execAsync('npm run lint:security');
    return { success: true, output: stdout };
  } catch (error) {
    return { success: false, output: error.stdout || error.message };
  }
}

/**
 * Runs secrets scanning. In a real environment, this might call gitleaks or trufflehog.
 * For this script, we'll check the eslint-plugin-no-secrets rule.
 * @returns {Promise<{success: boolean, output: string}>} The result of the secrets scan.
 */
async function runSecretsScan() {
  try {
    // If gitleaks is installed globally we could use it, but keeping it simpler with eslint no-secrets
    const { stdout } = await execAsync('npx eslint . --plugin no-secrets --rule "no-secrets/no-secrets: error"');
    return { success: true, output: stdout };
  } catch (error) {
    return { success: false, output: error.stdout || error.message };
  }
}

/**
 * Runs all security scans and aggregates the results.
 * @returns {Promise<{allPassed: boolean, results: object}>} Aggregated results.
 */
async function runAllScans() {
  const auditResult = await runNpmAudit();
  const sastResult = await runSast();
  const secretsResult = await runSecretsScan();

  const allPassed = auditResult.success && sastResult.success && secretsResult.success;

  return {
    allPassed,
    results: {
      npmAudit: auditResult,
      sast: sastResult,
      secrets: secretsResult
    }
  };
}

module.exports = {
  runNpmAudit,
  runSast,
  runSecretsScan,
  runAllScans
};

// If run directly
if (require.main === module) {
  runAllScans().then(({ allPassed, results }) => {
    console.log('--- Security Scan Results ---');
    console.log('npm audit:', results.npmAudit.success ? 'PASS' : 'FAIL');
    console.log('SAST:', results.sast.success ? 'PASS' : 'FAIL');
    console.log('Secrets:', results.secrets.success ? 'PASS' : 'FAIL');
    
    if (!allPassed) {
      console.error('Security scan failed!');
      process.exit(1);
    } else {
      console.log('All security scans passed!');
      process.exit(0);
    }
  });
}
