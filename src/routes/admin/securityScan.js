'use strict';

/**
 * Admin Security Scan Routes
 *
 * RESPONSIBILITY: Expose the static security scan as an API endpoint so that
 * CI/CD pipelines and security teams can trigger and retrieve scan results
 * without requiring direct server access.
 *
 * Endpoints:
 *   POST /admin/security/scan          — trigger a new scan (returns jobId immediately)
 *   GET  /admin/security/scan/:jobId   — poll job status and retrieve results
 *
 * Constraints:
 *   - Requires admin role
 *   - Only one scan may run at a time (concurrent requests → 409)
 *   - Scan results are retained for 7 days then purged from the in-memory store
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { runAllScans } = require('../../scripts/security-scan');
const asyncHandler = require('../../utils/asyncHandler');

// ─── In-memory job store ──────────────────────────────────────────────────────

/**
 * @typedef {Object} ScanJob
 * @property {string}   jobId
 * @property {'running'|'completed'|'failed'} status
 * @property {Array}    findings
 * @property {{high:number,medium:number,low:number}} summary
 * @property {string}   scannedAt   — ISO timestamp when the scan completed (or null while running)
 * @property {string}   startedAt   — ISO timestamp when the scan was triggered
 * @property {number}   expiresAt   — Unix ms timestamp after which the record may be purged
 */

/** @type {Map<string, ScanJob>} */
const jobs = new Map();

/** True while a scan is actively running. */
let scanInProgress = false;

const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Remove expired jobs from the in-memory store.
 * Called lazily on each GET request to avoid a background timer in tests.
 */
function purgeExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.expiresAt <= now) {
      jobs.delete(id);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Map the raw output from runAllScans() into the structured findings array
 * expected by the API contract.
 *
 * Each scan tool returns { success, output } where output is a string.
 * We parse the output for severity indicators and build finding objects.
 *
 * @param {{ allPassed: boolean, results: { npmAudit, sast, secrets } }} scanResult
 * @returns {{ findings: Array, summary: {high:number,medium:number,low:number} }}
 */
function buildFindings(scanResult) {
  const findings = [];

  /**
   * Parse a single tool's output into findings.
   * @param {string} toolName
   * @param {{ success: boolean, output: string }} result
   */
  function parseTool(toolName, result) {
    if (result.success) return; // no findings for passing tools

    const lines = (result.output || '').split('\n');
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Determine severity from keywords in the output line
      let severity = 'LOW';
      if (/\b(critical|high)\b/i.test(trimmed)) {
        severity = 'HIGH';
      } else if (/\b(moderate|medium|warn)\b/i.test(trimmed)) {
        severity = 'MEDIUM';
      }

      findings.push({
        severity,
        file: `src/scripts/security-scan.js (${toolName})`,
        line: idx + 1,
        description: trimmed.slice(0, 500), // cap length for safety
      });
    });

    // If the tool failed but produced no parseable lines, add a generic finding
    if (findings.length === 0 || !lines.some(l => l.trim())) {
      findings.push({
        severity: 'HIGH',
        file: `src/scripts/security-scan.js (${toolName})`,
        line: 0,
        description: `${toolName} scan failed: ${(result.output || 'unknown error').slice(0, 500)}`,
      });
    }
  }

  parseTool('npm-audit', scanResult.results.npmAudit);
  parseTool('sast', scanResult.results.sast);
  parseTool('secrets', scanResult.results.secrets);

  const summary = findings.reduce(
    (acc, f) => {
      if (f.severity === 'HIGH') acc.high++;
      else if (f.severity === 'MEDIUM') acc.medium++;
      else acc.low++;
      return acc;
    },
    { high: 0, medium: 0, low: 0 },
  );

  return { findings, summary };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /admin/security/scan
 *
 * Triggers a security scan as a background job.
 * Returns 202 Accepted with { jobId } immediately.
 * Returns 409 Conflict if a scan is already running.
 */
router.post(
  '/',
  checkPermission(PERMISSIONS.ADMIN_ALL),
  asyncHandler(async (req, res) => {
    if (scanInProgress) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'SCAN_ALREADY_RUNNING',
          message: 'A security scan is already in progress. Please wait for it to complete.',
        },
      });
    }

    const jobId = `scan-${uuidv4()}`;
    const startedAt = new Date().toISOString();

    /** @type {ScanJob} */
    const job = {
      jobId,
      status: 'running',
      findings: [],
      summary: { high: 0, medium: 0, low: 0 },
      scannedAt: null,
      startedAt,
      expiresAt: Date.now() + JOB_TTL_MS,
    };

    jobs.set(jobId, job);
    scanInProgress = true;

    // Run the scan asynchronously — do not await
    runAllScans()
      .then((scanResult) => {
        const { findings, summary } = buildFindings(scanResult);
        job.status = 'completed';
        job.findings = findings;
        job.summary = summary;
        job.scannedAt = new Date().toISOString();
        // Extend TTL from completion time
        job.expiresAt = Date.now() + JOB_TTL_MS;
      })
      .catch((err) => {
        job.status = 'failed';
        job.findings = [
          {
            severity: 'HIGH',
            file: 'src/scripts/security-scan.js',
            line: 0,
            description: `Scan execution error: ${err.message}`,
          },
        ];
        job.summary = { high: 1, medium: 0, low: 0 };
        job.scannedAt = new Date().toISOString();
        job.expiresAt = Date.now() + JOB_TTL_MS;
      })
      .finally(() => {
        scanInProgress = false;
      });

    return res.status(202).json({
      success: true,
      data: { jobId },
    });
  }),
);

/**
 * GET /admin/security/scan/:jobId
 *
 * Returns the current status and results of a scan job.
 * Purges expired jobs on each call (lazy GC).
 */
router.get(
  '/:jobId',
  checkPermission(PERMISSIONS.ADMIN_ALL),
  asyncHandler(async (req, res) => {
    purgeExpiredJobs();

    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SCAN_JOB_NOT_FOUND',
          message: `Scan job '${jobId}' not found or has expired.`,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        findings: job.findings,
        summary: job.summary,
        scannedAt: job.scannedAt,
        startedAt: job.startedAt,
      },
    });
  }),
);

// ─── Exports (also expose internals for testing) ──────────────────────────────

module.exports = router;
module.exports._jobs = jobs;
module.exports._getScanInProgress = () => scanInProgress;
module.exports._setScanInProgress = (v) => { scanInProgress = v; };
module.exports._buildFindings = buildFindings;
