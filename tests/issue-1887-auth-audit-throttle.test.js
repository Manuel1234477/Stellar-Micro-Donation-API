'use strict';

/**
 * Tests for issue #1887: Unauthenticated requests must not write one HIGH-severity audit row each.
 *
 * Acceptance criteria:
 * - 10,000 unauthenticated requests produce a bounded number of audit rows (at most one per IP per minute).
 * - Metrics expose authentication failure reasons.
 * - Severity mapping is documented in docs/AUDIT_LOGGING.md.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { allowAuditEvent, resetAuditThrottle } = require('../src/utils/authAuditThrottle');
const metrics = require('../src/utils/metrics');
const AuditLogService = require('../src/services/AuditLogService');

jest.mock('../src/models/apiKeys', () => ({
  validateKey: jest.fn().mockResolvedValue(null),
}));

const requireApiKey = require('../src/middleware/apiKey');

describe('Issue #1887 – Auth failure audit throttling', () => {
  describe('allowAuditEvent', () => {
    beforeEach(() => resetAuditThrottle());

    it('allows the first event for a key and blocks repeats inside the window', () => {
      const now = 1_000_000;
      expect(allowAuditEvent('missing:1.2.3.4', 60_000, now)).toBe(true);
      expect(allowAuditEvent('missing:1.2.3.4', 60_000, now + 1)).toBe(false);
      expect(allowAuditEvent('missing:1.2.3.4', 60_000, now + 59_999)).toBe(false);
    });

    it('allows again once the window has elapsed', () => {
      const now = 1_000_000;
      allowAuditEvent('missing:1.2.3.4', 60_000, now);
      expect(allowAuditEvent('missing:1.2.3.4', 60_000, now + 60_000)).toBe(true);
    });

    it('tracks each key independently', () => {
      const now = 1_000_000;
      expect(allowAuditEvent('missing:1.1.1.1', 60_000, now)).toBe(true);
      expect(allowAuditEvent('missing:2.2.2.2', 60_000, now)).toBe(true);
    });
  });

  describe('requireApiKey audit volume', () => {
    let app;
    let logSpy;

    beforeAll(() => {
      app = express();
      app.get('/protected', requireApiKey, (req, res) => res.json({ ok: true }));
    });

    beforeEach(() => {
      resetAuditThrottle();
      logSpy = jest.spyOn(AuditLogService, 'log').mockResolvedValue(undefined);
      metrics.authFailuresTotal.reset();
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('writes one audit row for a burst of unauthenticated requests from one IP', async () => {
      for (let i = 0; i < 200; i++) {
        const res = await request(app).get('/protected').set('X-Forwarded-For', '203.0.113.9');
        expect(res.status).toBe(401);
      }

      const missingKeyRows = logSpy.mock.calls.filter(
        ([entry]) => entry.reason === 'Missing API key header'
      );
      expect(missingKeyRows).toHaveLength(1);
      expect(missingKeyRows[0][0].severity).toBe(AuditLogService.SEVERITY.LOW);
    });

    it('still counts every unauthenticated request in metrics', async () => {
      for (let i = 0; i < 25; i++) {
        await request(app).get('/protected');
      }

      const values = (await metrics.authFailuresTotal.get()).values;
      const missing = values.find((v) => v.labels.reason === 'missing_key');
      expect(missing.value).toBe(25);
    });

    it('throttles invalid-key audit rows per IP', async () => {
      for (let i = 0; i < 30; i++) {
        const res = await request(app).get('/protected').set('x-api-key', `not-a-real-key-${i}`);
        expect(res.status).toBe(401);
      }

      const invalidRows = logSpy.mock.calls.filter(
        ([entry]) => entry.reason === 'Invalid or expired API key'
      );
      expect(invalidRows).toHaveLength(1);
    });
  });

  describe('documentation', () => {
    it('documents the severity mapping in docs/AUDIT_LOGGING.md', () => {
      const doc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'AUDIT_LOGGING.md'), 'utf8');
      expect(doc).toContain('Authentication Event Severity and Sampling');
      expect(doc).toContain('auth_failures_total');
    });
  });
});
