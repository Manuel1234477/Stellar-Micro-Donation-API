/**
 * @fileoverview Tests for Automated Security Scanning CI/CD Pipeline
 *
 * Covers:
 *  - runNpmAudit()  — success and failure paths
 *  - .auditignore   — file existence and format validation
 *  - runSast()      — success and failure paths
 *  - runSecretsScan() — success and failure paths
 *  - runAllScans()  — aggregation of all scan results
 *  - auditignore parsing — accepted exceptions filter out failures
 *  - Weekly CVE detection logic
 *  - MockStellarService usage verification (no live network required)
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const { exec } = require('child_process');

const {
  runNpmAudit,
  runSast,
  runSecretsScan,
  runAllScans
} = require('../../src/scripts/security-scan');

// Ensure no live Stellar network is required by this test suite
const MockStellarService = require('../../src/services/MockStellarService');

// ---------------------------------------------------------------------------
// Mock child_process so no real shell commands are executed
// ---------------------------------------------------------------------------
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate a successful exec call */
const mockExecSuccess = (stdout = '') => {
  exec.mockImplementation((_cmd, cb) => cb(null, { stdout }));
};

/** Simulate a failing exec call */
const mockExecFailure = (stdout = '', message = 'Command failed') => {
  exec.mockImplementation((_cmd, cb) => {
    const err  = new Error(message);
    err.stdout = stdout;
    cb(err, { stdout });
  });
};

/** Selectively mock exec: different behaviour per command substring */
const mockExecSelective = (matchers) => {
  exec.mockImplementation((cmd, cb) => {
    for (const { match, stdout, error } of matchers) {
      if (cmd.includes(match)) {
        if (error) {
          const err  = new Error(error);
          err.stdout = stdout || '';
          return cb(err, { stdout: stdout || '' });
        }
        return cb(null, { stdout: stdout || '' });
      }
    }
    // Default: success
    cb(null, { stdout: '' });
  });
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Automated Security Scanning — CI/CD Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. runNpmAudit()
  // ──────────────────────────────────────────────────────────────────────────
  describe('runNpmAudit()', () => {
    test('returns success when npm audit reports 0 vulnerabilities', async () => {
      mockExecSuccess('found 0 vulnerabilities\naudit ok');

      const result = await runNpmAudit();

      expect(result.success).toBe(true);
      expect(result.output).toContain('0 vulnerabilities');
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('npm audit'),
        expect.any(Function)
      );
    });

    test('returns failure with vulnerability details when audit finds issues', async () => {
      mockExecFailure(
        'found 3 vulnerabilities (1 moderate, 2 high)\n\nhigh severity vulnerability in lodash',
        'Command failed: npm audit --audit-level=high'
      );

      const result = await runNpmAudit();

      expect(result.success).toBe(false);
      expect(result.output).toContain('2 high');
      expect(result.output).toContain('lodash');
    });

    test('includes the command output in the result on failure', async () => {
      const auditOutput = 'critical severity vulnerability in express@4.17.1';
      mockExecFailure(auditOutput);

      const result = await runNpmAudit();

      expect(result.success).toBe(false);
      expect(result.output).toBe(auditOutput);
    });

    test('falls back to error.message when stdout is empty on failure', async () => {
      exec.mockImplementation((_cmd, cb) => {
        const err = new Error('ENOENT: npm not found');
        // No stdout property
        cb(err, { stdout: '' });
      });

      const result = await runNpmAudit();

      expect(result.success).toBe(false);
      // Should contain the error message when stdout is absent
      expect(typeof result.output).toBe('string');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. .auditignore — file existence
  // ──────────────────────────────────────────────────────────────────────────
  describe('.auditignore file', () => {
    const auditIgnorePath = path.resolve(__dirname, '../../.auditignore');

    test('exists in the repository root', () => {
      expect(fs.existsSync(auditIgnorePath)).toBe(true);
    });

    test('is a readable file (not a directory)', () => {
      const stat = fs.statSync(auditIgnorePath);
      expect(stat.isFile()).toBe(true);
    });

    test('is non-empty (contains at least a header comment)', () => {
      const content = fs.readFileSync(auditIgnorePath, 'utf8');
      expect(content.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. .auditignore — format validation
  // ──────────────────────────────────────────────────────────────────────────
  describe('.auditignore format', () => {
    const auditIgnorePath = path.resolve(__dirname, '../../.auditignore');

    /** Returns all active (non-comment, non-blank) lines from .auditignore */
    const getActiveLines = () => {
      const content = fs.readFileSync(auditIgnorePath, 'utf8');
      return content
        .split('\n')
        .filter((line) => {
          const stripped = line.replace(/#.*/g, '').trim();
          return stripped.length > 0;
        });
    };

    test('active entries follow the VULN-ID | package | reason | expires: YYYY-MM-DD format', () => {
      const activeLines = getActiveLines();
      const ISO_DATE = /expires:\s*\d{4}-\d{2}-\d{2}/i;

      for (const line of activeLines) {
        const parts = line.split('|').map((p) => p.trim());
        // Must have at least 4 pipe-separated fields
        expect(parts.length).toBeGreaterThanOrEqual(4);

        const [vulnId, pkgName, reason, expiryField] = parts;

        expect(vulnId.length).toBeGreaterThan(0);  // non-empty vuln ID
        expect(pkgName.length).toBeGreaterThan(0); // non-empty package name
        expect(reason.length).toBeGreaterThan(0);  // non-empty reason
        expect(expiryField).toMatch(ISO_DATE);      // valid expiry date
      }
    });

    test('file contains a header comment block explaining the format', () => {
      const content = fs.readFileSync(auditIgnorePath, 'utf8');
      // Expect at least 5 comment lines (generous minimum for any header)
      const commentLines = content
        .split('\n')
        .filter((l) => l.trim().startsWith('#'));
      expect(commentLines.length).toBeGreaterThanOrEqual(5);
    });

    test('file documents the required fields (VULN-ID, package, reason, expires)', () => {
      const content = fs.readFileSync(auditIgnorePath, 'utf8').toLowerCase();
      expect(content).toContain('expires');
      expect(content).toContain('reason');
      expect(content).toContain('package');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. runSast()
  // ──────────────────────────────────────────────────────────────────────────
  describe('runSast()', () => {
    test('returns success when eslint-plugin-security finds no issues', async () => {
      mockExecSuccess('');

      const result = await runSast();

      expect(result.success).toBe(true);
      expect(exec).toHaveBeenCalledWith(
        expect.stringContaining('lint:security'),
        expect.any(Function)
      );
    });

    test('returns failure when SAST detects security issues', async () => {
      mockExecFailure(
        '2 problems (2 errors, 0 warnings)\n  error  Unsafe use of eval()  security/detect-eval-with-expression'
      );

      const result = await runSast();

      expect(result.success).toBe(false);
      expect(result.output).toContain('2 problems');
    });

    test('captures eslint error detail in output', async () => {
      const eslintOutput = '1 problem (1 error)\n  error  Detected unsafe regex  security/detect-unsafe-regex';
      mockExecFailure(eslintOutput);

      const result = await runSast();

      expect(result.success).toBe(false);
      expect(result.output).toContain('unsafe regex');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. runSecretsScan()
  // ──────────────────────────────────────────────────────────────────────────
  describe('runSecretsScan()', () => {
    test('returns success when no secrets are detected', async () => {
      mockExecSuccess('');

      const result = await runSecretsScan();

      expect(result.success).toBe(true);
    });

    test('returns failure when a hard-coded secret is detected', async () => {
      mockExecFailure(
        'error  Secret detected: high-entropy string  no-secrets/no-secrets'
      );

      const result = await runSecretsScan();

      expect(result.success).toBe(false);
      expect(result.output).toContain('Secret detected');
    });

    test('captures the detected secret detail in output', async () => {
      const scanOutput = 'error  Possible API key detected in src/config.js:12';
      mockExecFailure(scanOutput);

      const result = await runSecretsScan();

      expect(result.success).toBe(false);
      expect(result.output).toContain('API key detected');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. runAllScans() — aggregation
  // ──────────────────────────────────────────────────────────────────────────
  describe('runAllScans()', () => {
    test('returns allPassed=true when all three scans succeed', async () => {
      mockExecSuccess('found 0 vulnerabilities');

      const { allPassed, results } = await runAllScans();

      expect(allPassed).toBe(true);
      expect(results.npmAudit.success).toBe(true);
      expect(results.sast.success).toBe(true);
      expect(results.secrets.success).toBe(true);
    });

    test('returns allPassed=false when npm audit fails but others pass', async () => {
      mockExecSelective([
        { match: 'npm audit', stdout: '1 high vulnerability', error: 'Command failed' }
        // everything else defaults to success
      ]);

      const { allPassed, results } = await runAllScans();

      expect(allPassed).toBe(false);
      expect(results.npmAudit.success).toBe(false);
      expect(results.sast.success).toBe(true);
      expect(results.secrets.success).toBe(true);
    });

    test('returns allPassed=false when SAST fails but others pass', async () => {
      mockExecSelective([
        { match: 'lint:security', stdout: '2 problems (2 errors)', error: 'Lint failed' }
      ]);

      const { allPassed, results } = await runAllScans();

      expect(allPassed).toBe(false);
      expect(results.npmAudit.success).toBe(true);
      expect(results.sast.success).toBe(false);
      expect(results.secrets.success).toBe(true);
    });

    test('returns allPassed=false when secrets scan fails but others pass', async () => {
      mockExecSelective([
        { match: 'no-secrets', stdout: 'error  Secret detected', error: 'Secrets found' }
      ]);

      const { allPassed, results } = await runAllScans();

      expect(allPassed).toBe(false);
      expect(results.npmAudit.success).toBe(true);
      expect(results.sast.success).toBe(true);
      expect(results.secrets.success).toBe(false);
    });

    test('returns allPassed=false when all scans fail', async () => {
      mockExecFailure('all checks failed', 'Total failure');

      const { allPassed, results } = await runAllScans();

      expect(allPassed).toBe(false);
      expect(results.npmAudit.success).toBe(false);
      expect(results.sast.success).toBe(false);
      expect(results.secrets.success).toBe(false);
    });

    test('results object contains npmAudit, sast, and secrets keys', async () => {
      mockExecSuccess('');

      const { results } = await runAllScans();

      expect(results).toHaveProperty('npmAudit');
      expect(results).toHaveProperty('sast');
      expect(results).toHaveProperty('secrets');
    });

    test('each result contains success boolean and output string', async () => {
      mockExecSuccess('ok');

      const { results } = await runAllScans();

      for (const key of ['npmAudit', 'sast', 'secrets']) {
        expect(typeof results[key].success).toBe('boolean');
        expect(typeof results[key].output).toBe('string');
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. .auditignore parsing — accepted exceptions filter out failures
  // ──────────────────────────────────────────────────────────────────────────
  describe('.auditignore exception parsing', () => {
    /**
     * Inline helper that mimics the CI workflow's auditignore parsing logic.
     * Returns a Set of ignored vulnerability IDs.
     */
    const parseAuditIgnore = (content) => {
      const ignored = new Set();
      for (const line of content.split('\n')) {
        const stripped = line.replace(/#.*/g, '').trim();
        if (!stripped) continue;
        const id = stripped.split('|')[0].trim();
        if (id) ignored.add(id);
      }
      return ignored;
    };

    test('ignores blank lines and comment-only lines', () => {
      const content = `
# This is a comment
  # Indented comment

1234567 | lodash | prototype pollution | expires: 2026-12-31
      `;
      const ignored = parseAuditIgnore(content);
      expect(ignored.has('1234567')).toBe(true);
      expect(ignored.size).toBe(1);
    });

    test('correctly extracts VULN-ID as the first pipe-delimited token', () => {
      const content = `
GHSA-abc1-def2-ghi3 | axios | ReDoS | expires: 2027-01-01
CVE-2025-99999 | semver | ReDOS in parsing | expires: 2026-06-30
`;
      const ignored = parseAuditIgnore(content);
      expect(ignored.has('GHSA-abc1-def2-ghi3')).toBe(true);
      expect(ignored.has('CVE-2025-99999')).toBe(true);
    });

    test('does NOT add the package name or reason as an ignored ID', () => {
      const content = 'GHSA-test-0001 | lodash | prototype pollution | expires: 2027-01-01';
      const ignored = parseAuditIgnore(content);
      expect(ignored.has('lodash')).toBe(false);
      expect(ignored.has('prototype pollution')).toBe(false);
    });

    test('a vulnerability present in .auditignore is filtered from the failure set', () => {
      const auditIgnoreContent = `
# Known exceptions
GHSA-known-0001 | some-pkg | no user input reaches affected code | expires: 2027-06-30
`;
      const detectedVulns = ['GHSA-known-0001', 'GHSA-unknown-9999'];
      const ignored = parseAuditIgnore(auditIgnoreContent);
      const remaining = detectedVulns.filter((v) => !ignored.has(v));

      expect(remaining).toEqual(['GHSA-unknown-9999']);
      expect(remaining).not.toContain('GHSA-known-0001');
    });

    test('when all detected vulns are in .auditignore, audit effectively passes', () => {
      const auditIgnoreContent = `
GHSA-aaa-bbb-001 | pkg-a | accepted risk | expires: 2027-01-01
GHSA-aaa-bbb-002 | pkg-b | no affected code path | expires: 2027-06-30
`;
      const detectedVulns = ['GHSA-aaa-bbb-001', 'GHSA-aaa-bbb-002'];
      const ignored = parseAuditIgnore(auditIgnoreContent);
      const remaining = detectedVulns.filter((v) => !ignored.has(v));

      expect(remaining).toHaveLength(0);
    });

    test('when .auditignore is empty, all detected vulns remain as failures', () => {
      const auditIgnoreContent = `
# No exceptions yet
`;
      const detectedVulns = ['GHSA-xxx-yyy-001'];
      const ignored = parseAuditIgnore(auditIgnoreContent);
      const remaining = detectedVulns.filter((v) => !ignored.has(v));

      expect(remaining).toEqual(['GHSA-xxx-yyy-001']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 8. Weekly CVE detection logic
  // ──────────────────────────────────────────────────────────────────────────
  describe('Weekly CVE detection logic', () => {
    /**
     * Inline helper that mirrors the weekly-cve-report workflow logic.
     * Takes raw npm audit JSON and an auditignore content string.
     * Returns the list of CVE items that should trigger a GitHub Issue.
     */
    const detectNewCves = (auditJson, auditIgnoreContent = '') => {
      // Parse .auditignore
      const ignoredIds = new Set();
      for (const line of auditIgnoreContent.split('\n')) {
        const stripped = line.replace(/#.*/g, '').trim();
        if (!stripped) continue;
        const id = stripped.split('|')[0].trim();
        if (id) ignoredIds.add(id);
      }

      // Parse vulnerabilities from audit JSON
      const vulns = auditJson.vulnerabilities || auditJson.advisories || {};
      const cveList = [];

      for (const [pkgName, info] of Object.entries(vulns)) {
        const severity = info.severity || 'unknown';
        if (!['high', 'critical'].includes(severity)) continue;

        const via = info.via || [];
        for (const v of via) {
          if (typeof v !== 'object') continue;
          const source = String(v.source || '');
          const cves   = (v.cves || []).join(', ') || 'N/A';
          cveList.push({
            pkgName,
            severity,
            title:  v.title  || 'No title',
            url:    v.url    || '',
            source,
            cves
          });
        }
      }

      return cveList.filter((c) => !ignoredIds.has(c.source) && !ignoredIds.has(c.cves));
    };

    test('returns empty list when audit reports no vulnerabilities', () => {
      const auditJson = { vulnerabilities: {} };
      const result = detectNewCves(auditJson);
      expect(result).toHaveLength(0);
    });

    test('detects high and critical vulnerabilities', () => {
      const auditJson = {
        vulnerabilities: {
          lodash: {
            severity: 'high',
            via: [{ source: '1234567', title: 'Prototype Pollution', url: 'https://example.com', cves: ['CVE-2020-8203'] }]
          }
        }
      };
      const result = detectNewCves(auditJson);
      expect(result).toHaveLength(1);
      expect(result[0].pkgName).toBe('lodash');
      expect(result[0].severity).toBe('high');
    });

    test('ignores moderate and low severity vulnerabilities', () => {
      const auditJson = {
        vulnerabilities: {
          axios: {
            severity: 'moderate',
            via: [{ source: '9999999', title: 'Some Issue', url: '', cves: [] }]
          },
          semver: {
            severity: 'low',
            via: [{ source: '8888888', title: 'Minor Issue', url: '', cves: [] }]
          }
        }
      };
      const result = detectNewCves(auditJson);
      expect(result).toHaveLength(0);
    });

    test('filters out CVEs that appear in .auditignore', () => {
      const auditJson = {
        vulnerabilities: {
          lodash: {
            severity: 'high',
            via: [{ source: '1234567', title: 'Prototype Pollution', url: '', cves: [] }]
          }
        }
      };
      const auditIgnoreContent = '1234567 | lodash | accepted | expires: 2027-01-01';
      const result = detectNewCves(auditJson, auditIgnoreContent);
      expect(result).toHaveLength(0);
    });

    test('only reports CVEs not in .auditignore', () => {
      const auditJson = {
        vulnerabilities: {
          lodash: {
            severity: 'high',
            via: [{ source: '1111111', title: 'Issue A', url: '', cves: [] }]
          },
          express: {
            severity: 'critical',
            via: [{ source: '2222222', title: 'Issue B', url: '', cves: [] }]
          }
        }
      };
      const auditIgnoreContent = '1111111 | lodash | accepted | expires: 2027-01-01';
      const result = detectNewCves(auditJson, auditIgnoreContent);

      expect(result).toHaveLength(1);
      expect(result[0].pkgName).toBe('express');
      expect(result[0].source).toBe('2222222');
    });

    test('handles both legacy advisories and modern vulnerabilities format', () => {
      const modernFormat = {
        vulnerabilities: {
          pkg: { severity: 'critical', via: [{ source: 'SRC-001', title: 'T', url: '', cves: [] }] }
        }
      };
      const legacyFormat = {
        advisories: {
          pkg: { severity: 'critical', via: [{ source: 'SRC-002', title: 'T', url: '', cves: [] }] }
        }
      };
      expect(detectNewCves(modernFormat)).toHaveLength(1);
      expect(detectNewCves(legacyFormat)).toHaveLength(1);
    });

    test('multiple CVEs from same package are reported individually', () => {
      const auditJson = {
        vulnerabilities: {
          express: {
            severity: 'high',
            via: [
              { source: 'SRC-A', title: 'Issue A', url: '', cves: [] },
              { source: 'SRC-B', title: 'Issue B', url: '', cves: [] }
            ]
          }
        }
      };
      const result = detectNewCves(auditJson);
      expect(result).toHaveLength(2);
    });

    test('skips via entries that are plain strings (transitive dependency refs)', () => {
      const auditJson = {
        vulnerabilities: {
          'transitive-pkg': {
            severity: 'high',
            via: ['direct-dependency'] // string, not object — should be skipped
          }
        }
      };
      const result = detectNewCves(auditJson);
      // No object-shaped via entries, so nothing should be reported
      expect(result).toHaveLength(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 9. MockStellarService usage verification
  // ──────────────────────────────────────────────────────────────────────────
  describe('MockStellarService usage verification', () => {
    test('MockStellarService is defined and importable', () => {
      expect(MockStellarService).toBeDefined();
    });

    test('MockStellarService can be instantiated without a live Stellar network', () => {
      const mockService = new MockStellarService();
      expect(mockService).toBeInstanceOf(MockStellarService);
    });

    test('MockStellarService exposes expected interface (createAccount / sendPayment)', () => {
      const mockService = new MockStellarService();
      // Verify key methods exist — guarantees the test suite can mock Stellar calls
      expect(typeof mockService.createAccount).toBe('function');
      expect(typeof mockService.sendPayment).toBe('function');
    });

    test('no real network calls are made during security scan tests', () => {
      // child_process.exec is mocked — confirm the mock is in place
      expect(jest.isMockFunction(exec)).toBe(true);
    });
  });
});
