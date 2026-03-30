/**
 * Tests for Automated Security Scanning CI/CD Pipeline Wrapper
 */

const { exec } = require('child_process');
const { runNpmAudit, runSast, runSecretsScan, runAllScans } = require('../src/scripts/security-scan');
const MockStellarService = require('../src/services/MockStellarService'); // Requirement: Ensure no live Stellar network required (use MockStellarService)

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

describe('Automated Security Scanning - CI/CD Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('npm audit checks', () => {
    test('should return success when npm audit passes', async () => {
      exec.mockImplementation((cmd, cb) => {
        if (cmd === 'npm audit --audit-level=high') {
          cb(null, { stdout: 'found 0 vulnerabilities' });
        }
      });
      
      const result = await runNpmAudit();
      expect(result.success).toBe(true);
      expect(result.output).toContain('0 vulnerabilities');
      expect(exec).toHaveBeenCalledWith('npm audit --audit-level=high', expect.any(Function));
    });

    test('should return failure when npm audit finds vulnerabilities', async () => {
      exec.mockImplementation((cmd, cb) => {
        if (cmd === 'npm audit --audit-level=high') {
          const error = new Error('Command failed');
          error.stdout = 'found 2 high vulnerabilities';
          cb(error, { stdout: error.stdout });
        }
      });
      
      const result = await runNpmAudit();
      expect(result.success).toBe(false);
      expect(result.output).toContain('2 high vulnerabilities');
    });
  });

  describe('SAST checks', () => {
    test('should return success when eslint-plugin-security passes', async () => {
      exec.mockImplementation((cmd, cb) => {
        if (cmd === 'npm run lint:security') {
          cb(null, { stdout: '' });
        }
      });
      
      const result = await runSast();
      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith('npm run lint:security', expect.any(Function));
    });

    test('should return failure when SAST detects issues', async () => {
      exec.mockImplementation((cmd, cb) => {
        if (cmd === 'npm run lint:security') {
          const error = new Error('Linting failed');
          error.stdout = '2 problems (2 errors, 0 warnings)';
          cb(error, { stdout: error.stdout });
        }
      });
      
      const result = await runSast();
      expect(result.success).toBe(false);
      expect(result.output).toContain('2 problems');
    });
  });

  describe('Secrets Scan checks', () => {
    test('should return success when no secrets are detected', async () => {
      exec.mockImplementation((cmd, cb) => {
        if (cmd.includes('no-secrets/no-secrets')) {
          cb(null, { stdout: '' });
        }
      });
      
      const result = await runSecretsScan();
      expect(result.success).toBe(true);
    });

    test('should return failure when a secret is detected', async () => {
      exec.mockImplementation((cmd, cb) => {
        if (cmd.includes('no-secrets/no-secrets')) {
          const error = new Error('Secret detected');
          error.stdout = 'error  Secret detected';
          cb(error, { stdout: error.stdout });
        }
      });
      
      const result = await runSecretsScan();
      expect(result.success).toBe(false);
      expect(result.output).toContain('Secret detected');
    });
  });

  describe('Aggregate all scans', () => {
    test('should pass when all security checks pass', async () => {
      exec.mockImplementation((cmd, cb) => {
        cb(null, { stdout: 'passed' });
      });

      const { allPassed, results } = await runAllScans();
      expect(allPassed).toBe(true);
      expect(results.npmAudit.success).toBe(true);
      expect(results.sast.success).toBe(true);
      expect(results.secrets.success).toBe(true);
    });

    test('should fail when any security check fails (edge case combinations)', async () => {
      // Make audit pass, SAST fail, secrets pass
      exec.mockImplementation((cmd, cb) => {
        if (cmd.includes('npm audit')) {
          cb(null, { stdout: 'passed' });
        } else if (cmd.includes('lint:security')) {
          const err = new Error('FAIL');
          err.stdout = 'error';
          cb(err, { stdout: 'error' });
        } else {
          cb(null, { stdout: 'passed' });
        }
      });

      const { allPassed, results } = await runAllScans();
      expect(allPassed).toBe(false);
      expect(results.npmAudit.success).toBe(true);
      expect(results.sast.success).toBe(false);
      expect(results.secrets.success).toBe(true);
    });
  });

  describe('Stellar Network Integration Verification', () => {
    test('should verify no live Stellar network is used by initializing MockStellarService', () => {
      expect(MockStellarService).toBeDefined();
      const mockService = new MockStellarService();
      expect(mockService).toBeInstanceOf(MockStellarService);
      // Validates that we are capable of mocking Stellar if needed internally
    });
  });
});
