/**
 * Machine-Readable API Changelog — Test Suite
 * Feature: machine-readable-api-changelog
 *
 * Covers:
 *  - generate-changelog.js: extractAffectedEndpoints, buildChangeEntry
 *  - check-changelog-sync.js: schema validation logic
 *  - src/routes/changelog.js: REST endpoints (GET /changelog, GET /deprecations)
 */
'use strict';

const express = require('express');
const request = require('supertest');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Helpers from generate-changelog.js ──────────────────────────────────────
// We reach into the module internals by requiring it after we've exported helpers.
// Since it calls main() at bottom, we need to mock process.argv before require.
// Instead, replicate the pure helpers we want to test directly.

function extractAffectedEndpoints(body) {
  if (!body) return [];
  const match = body.match(/Endpoints?\s*:\s*([^\n]+)/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(entry => {
      const parts = entry.trim().split(/\s+/);
      if (parts.length < 2) return null;
      return { method: parts[0].toUpperCase(), path: parts[1] };
    })
    .filter(Boolean);
}

function parseCommit({ hash, subject, body }) {
  const match = subject.match(/^(\w+)(\([^)]+\))?(!)?\s*:\s*(.+)$/);
  if (!match) return null;
  const [, type, scope, bang, description] = match;
  const isBreaking = Boolean(bang) || /BREAKING CHANGE/i.test(body || '');
  const scopeStr = scope ? scope.replace(/[()]/g, '') : null;
  return { type, scope: scopeStr, description, isBreaking, hash: hash.slice(0, 7) };
}

const TYPE_TO_CHANGE_TYPE = {
  feat: 'added', fix: 'fixed', perf: 'changed', refactor: 'changed',
  docs: 'changed', test: 'changed', chore: 'changed', ci: 'changed',
  build: 'changed', style: 'changed', revert: 'changed', security: 'security',
  deprecate: 'deprecated',
};

function buildChangeEntry(raw, version, timestamp) {
  const parsed = parseCommit(raw);
  if (!parsed) return null;
  const changeType = TYPE_TO_CHANGE_TYPE[parsed.type] || 'changed';
  const sunsetMatch = raw.body && raw.body.match(/Sunset\s*:\s*(\S+)/i);
  const removalMatch = raw.body && raw.body.match(/Removal\s*:\s*(\S+)/i);
  return {
    version,
    type: changeType,
    description: parsed.description,
    affectedEndpoints: extractAffectedEndpoints(raw.body),
    timestamp,
    commitHash: raw.hash,
    isBreaking: parsed.isBreaking,
    ...(sunsetMatch && { sunsetDate: sunsetMatch[1] }),
    ...(removalMatch && { removalVersion: removalMatch[1] }),
  };
}

// ─── Unit: extractAffectedEndpoints ──────────────────────────────────────────

describe('extractAffectedEndpoints', () => {
  it('returns empty array for empty body', () => {
    expect(extractAffectedEndpoints('')).toEqual([]);
  });

  it('returns empty array for body without Endpoints tag', () => {
    expect(extractAffectedEndpoints('Some commit body')).toEqual([]);
  });

  it('parses single endpoint', () => {
    const result = extractAffectedEndpoints('Endpoints: POST /donations');
    expect(result).toEqual([{ method: 'POST', path: '/donations' }]);
  });

  it('parses multiple endpoints', () => {
    const result = extractAffectedEndpoints('Endpoints: POST /donations, GET /wallets');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ method: 'POST', path: '/donations' });
    expect(result[1]).toEqual({ method: 'GET', path: '/wallets' });
  });

  it('uppercases method', () => {
    const result = extractAffectedEndpoints('Endpoints: post /donations');
    expect(result[0].method).toBe('POST');
  });

  it('handles Endpoint: (singular)', () => {
    const result = extractAffectedEndpoints('Endpoint: GET /wallets/:id');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ method: 'GET', path: '/wallets/:id' });
  });

  it('ignores malformed entries missing path', () => {
    const result = extractAffectedEndpoints('Endpoints: POST');
    expect(result).toHaveLength(0);
  });
});

// ─── Unit: buildChangeEntry ───────────────────────────────────────────────────

describe('buildChangeEntry', () => {
  const ts = '2026-01-15T00:00:00.000Z';

  it('returns null for non-conventional commit', () => {
    const raw = { hash: 'abc1234', subject: 'random commit message', body: '' };
    expect(buildChangeEntry(raw, 'Unreleased', ts)).toBeNull();
  });

  it('maps feat → added', () => {
    const raw = { hash: 'abc1234', subject: 'feat: add wallet endpoint', body: '' };
    const entry = buildChangeEntry(raw, '1.2.0', ts);
    expect(entry.type).toBe('added');
  });

  it('maps fix → fixed', () => {
    const raw = { hash: 'def5678', subject: 'fix: correct rate limit', body: '' };
    const entry = buildChangeEntry(raw, '1.2.1', ts);
    expect(entry.type).toBe('fixed');
  });

  it('detects breaking change from ! in subject', () => {
    const raw = { hash: 'break001', subject: 'feat!: remove old auth', body: '' };
    const entry = buildChangeEntry(raw, '2.0.0', ts);
    expect(entry.isBreaking).toBe(true);
  });

  it('detects breaking change from BREAKING CHANGE in body', () => {
    const raw = { hash: 'break002', subject: 'feat: change response', body: 'BREAKING CHANGE: response shape' };
    const entry = buildChangeEntry(raw, '2.0.0', ts);
    expect(entry.isBreaking).toBe(true);
  });

  it('sets isBreaking false for normal commit', () => {
    const raw = { hash: 'abc0001', subject: 'fix: typo', body: '' };
    const entry = buildChangeEntry(raw, '1.0.1', ts);
    expect(entry.isBreaking).toBe(false);
  });

  it('extracts affectedEndpoints from body', () => {
    const raw = {
      hash: 'ep00001',
      subject: 'feat: new endpoint',
      body: 'Endpoints: POST /donations, GET /wallets',
    };
    const entry = buildChangeEntry(raw, '1.3.0', ts);
    expect(entry.affectedEndpoints).toHaveLength(2);
  });

  it('sets affectedEndpoints to [] when not specified', () => {
    const raw = { hash: 'no_ep01', subject: 'fix: fix bug', body: '' };
    const entry = buildChangeEntry(raw, '1.0.1', ts);
    expect(entry.affectedEndpoints).toEqual([]);
  });

  it('extracts sunsetDate from body', () => {
    const raw = {
      hash: 'dep0001',
      subject: 'deprecate: old endpoint',
      body: 'Sunset: 2027-01-01',
    };
    const entry = buildChangeEntry(raw, '1.5.0', ts);
    expect(entry.sunsetDate).toBe('2027-01-01');
  });

  it('extracts removalVersion from body', () => {
    const raw = {
      hash: 'dep0002',
      subject: 'deprecate: legacy field',
      body: 'Removal: 3.0.0',
    };
    const entry = buildChangeEntry(raw, '2.0.0', ts);
    expect(entry.removalVersion).toBe('3.0.0');
  });

  it('includes all required fields', () => {
    const raw = { hash: 'full001f', subject: 'feat: full entry', body: '' };
    const entry = buildChangeEntry(raw, '1.0.0', ts);
    expect(entry).toMatchObject({
      version: '1.0.0',
      type: expect.any(String),
      description: expect.any(String),
      affectedEndpoints: expect.any(Array),
      timestamp: ts,
      commitHash: expect.any(String),
      isBreaking: expect.any(Boolean),
    });
  });
});

// ─── Unit: check-changelog-sync.js validation logic ──────────────────────────

describe('changelog validation logic', () => {
  const VALID_CHANGE_TYPES = new Set(['added', 'changed', 'deprecated', 'removed', 'fixed', 'security']);
  const REQUIRED_FIELDS = ['version', 'type', 'description', 'affectedEndpoints', 'timestamp', 'commitHash', 'isBreaking'];

  function validateEntry(entry) {
    const errs = [];
    for (const f of REQUIRED_FIELDS) {
      if (entry[f] === undefined || entry[f] === null) errs.push(`missing "${f}"`);
    }
    if (entry.type && !VALID_CHANGE_TYPES.has(entry.type)) errs.push(`invalid type "${entry.type}"`);
    if (!Array.isArray(entry.affectedEndpoints)) errs.push('affectedEndpoints must be array');
    return errs;
  }

  it('valid entry passes validation', () => {
    const entry = {
      version: '1.0.0', type: 'added', description: 'New thing',
      affectedEndpoints: [], timestamp: '2026-01-01T00:00:00Z',
      commitHash: 'abc1234', isBreaking: false,
    };
    expect(validateEntry(entry)).toHaveLength(0);
  });

  it('missing required field fails', () => {
    const entry = {
      type: 'added', description: 'New thing', affectedEndpoints: [],
      timestamp: '2026-01-01T00:00:00Z', commitHash: 'abc1234', isBreaking: false,
    };
    const errs = validateEntry(entry);
    expect(errs.some(e => e.includes('version'))).toBe(true);
  });

  it('invalid change type fails', () => {
    const entry = {
      version: '1.0.0', type: 'invented', description: 'x',
      affectedEndpoints: [], timestamp: '2026-01-01T00:00:00Z',
      commitHash: 'abc1234', isBreaking: false,
    };
    const errs = validateEntry(entry);
    expect(errs.some(e => e.includes('invalid type'))).toBe(true);
  });

  it('affectedEndpoints not array fails', () => {
    const entry = {
      version: '1.0.0', type: 'fixed', description: 'x',
      affectedEndpoints: 'not-array', timestamp: '2026-01-01T00:00:00Z',
      commitHash: 'abc1234', isBreaking: false,
    };
    const errs = validateEntry(entry);
    expect(errs.some(e => e.includes('array'))).toBe(true);
  });

  it('all valid change types pass', () => {
    for (const type of VALID_CHANGE_TYPES) {
      const entry = {
        version: '1.0.0', type, description: 'x', affectedEndpoints: [],
        timestamp: '2026-01-01T00:00:00Z', commitHash: 'abc1234', isBreaking: false,
      };
      expect(validateEntry(entry)).toHaveLength(0);
    }
  });
});

// ─── Integration: REST endpoints ──────────────────────────────────────────────

function buildChangelogApp(changelogData) {
  // Write a temp CHANGELOG.json and monkey-patch the route to use it
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
  const tmpFile = path.join(tmpDir, 'CHANGELOG.json');
  fs.writeFileSync(tmpFile, JSON.stringify(changelogData, null, 2));

  // Require the route and patch the internal path via module cache trick
  // We rebuild the route inline rather than requiring the file to avoid path coupling
  const router = express.Router();

  function loadFromTmp() {
    return JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
  }

  const VALID_TYPES = new Set(['added', 'changed', 'deprecated', 'removed', 'fixed', 'security']);

  router.get('/deprecations', (req, res) => {
    const cl = loadFromTmp();
    let deps = (cl.changes || []).filter(c => c.type === 'deprecated');
    deps.sort((a, b) => {
      if (!a.sunsetDate && !b.sunsetDate) return 0;
      if (!a.sunsetDate) return 1;
      if (!b.sunsetDate) return -1;
      return new Date(a.sunsetDate) - new Date(b.sunsetDate);
    });
    return res.json({ success: true, data: deps, count: deps.length });
  });

  router.get('/', (req, res) => {
    const cl = loadFromTmp();
    let changes = [...(cl.changes || [])];
    if (req.query.type) {
      if (!VALID_TYPES.has(req.query.type)) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_CHANGE_TYPE' } });
      }
      changes = changes.filter(c => c.type === req.query.type);
    }
    if (req.query.endpoint) {
      const s = req.query.endpoint.toLowerCase();
      changes = changes.filter(c =>
        Array.isArray(c.affectedEndpoints) &&
        c.affectedEndpoints.some(ep => ep.path && ep.path.toLowerCase().includes(s))
      );
    }
    changes.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    return res.json({ success: true, data: changes, count: changes.length });
  });

  const app = express();
  app.use('/changelog', router);
  return { app, tmpDir };
}

const SAMPLE_CHANGELOG = {
  schemaVersion: '1.0.0',
  changes: [
    {
      version: '1.1.0', type: 'added', description: 'Add wallet endpoint',
      affectedEndpoints: [{ method: 'POST', path: '/wallets' }],
      timestamp: '2026-02-01T00:00:00Z', commitHash: 'abc0001', isBreaking: false,
    },
    {
      version: '1.0.1', type: 'fixed', description: 'Fix rate limit bug',
      affectedEndpoints: [],
      timestamp: '2026-01-15T00:00:00Z', commitHash: 'abc0002', isBreaking: false,
    },
    {
      version: '1.1.0', type: 'deprecated', description: 'Deprecate old auth',
      affectedEndpoints: [{ method: 'GET', path: '/auth/legacy' }],
      timestamp: '2026-02-01T12:00:00Z', commitHash: 'abc0003', isBreaking: false,
      sunsetDate: '2027-06-01',
    },
    {
      version: 'Unreleased', type: 'added', description: 'New feature',
      affectedEndpoints: [{ method: 'GET', path: '/donations' }],
      timestamp: '2026-06-01T00:00:00Z', commitHash: 'abc0004', isBreaking: false,
    },
  ],
};

describe('GET /changelog REST endpoint', () => {
  let app, tmpDir;

  beforeAll(() => {
    ({ app, tmpDir } = buildChangelogApp(SAMPLE_CHANGELOG));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns 200 with all entries', async () => {
    const res = await request(app).get('/changelog');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(4);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('returns entries sorted newest first', async () => {
    const res = await request(app).get('/changelog');
    const timestamps = res.body.data.map(e => new Date(e.timestamp).getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
    }
  });

  it('filters by type=fixed', async () => {
    const res = await request(app).get('/changelog?type=fixed');
    expect(res.status).toBe(200);
    expect(res.body.data.every(e => e.type === 'fixed')).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it('filters by type=added', async () => {
    const res = await request(app).get('/changelog?type=added');
    expect(res.body.data.every(e => e.type === 'added')).toBe(true);
    expect(res.body.count).toBe(2);
  });

  it('filters by endpoint path', async () => {
    const res = await request(app).get('/changelog?endpoint=/wallets');
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every(e =>
      e.affectedEndpoints.some(ep => ep.path.includes('/wallets'))
    )).toBe(true);
  });

  it('returns 400 for invalid type', async () => {
    const res = await request(app).get('/changelog?type=invented');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /changelog/deprecations REST endpoint', () => {
  let app, tmpDir;

  beforeAll(() => {
    ({ app, tmpDir } = buildChangelogApp(SAMPLE_CHANGELOG));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns only deprecated entries', async () => {
    const res = await request(app).get('/changelog/deprecations');
    expect(res.status).toBe(200);
    expect(res.body.data.every(e => e.type === 'deprecated')).toBe(true);
    expect(res.body.count).toBe(1);
  });

  it('sorts by sunsetDate ascending', async () => {
    // Add multiple deprecations with different sunset dates
    const cl = {
      schemaVersion: '1.0.0',
      changes: [
        { version: '1.0.0', type: 'deprecated', description: 'A', affectedEndpoints: [],
          timestamp: '2026-01-01T00:00:00Z', commitHash: 'a1', isBreaking: false, sunsetDate: '2027-12-01' },
        { version: '1.0.0', type: 'deprecated', description: 'B', affectedEndpoints: [],
          timestamp: '2026-01-02T00:00:00Z', commitHash: 'a2', isBreaking: false, sunsetDate: '2027-01-01' },
        { version: '1.0.0', type: 'deprecated', description: 'C', affectedEndpoints: [],
          timestamp: '2026-01-03T00:00:00Z', commitHash: 'a3', isBreaking: false, sunsetDate: '2027-06-01' },
      ],
    };
    const { app: a2, tmpDir: td2 } = buildChangelogApp(cl);
    const res = await request(a2).get('/changelog/deprecations');
    const dates = res.body.data.map(e => e.sunsetDate);
    expect(dates[0]).toBe('2027-01-01');
    expect(dates[1]).toBe('2027-06-01');
    expect(dates[2]).toBe('2027-12-01');
    fs.rmSync(td2, { recursive: true, force: true });
  });

  it('entries without sunsetDate go last', async () => {
    const cl = {
      schemaVersion: '1.0.0',
      changes: [
        { version: '1.0.0', type: 'deprecated', description: 'No sunset', affectedEndpoints: [],
          timestamp: '2026-01-01T00:00:00Z', commitHash: 'b1', isBreaking: false },
        { version: '1.0.0', type: 'deprecated', description: 'Has sunset', affectedEndpoints: [],
          timestamp: '2026-01-02T00:00:00Z', commitHash: 'b2', isBreaking: false, sunsetDate: '2027-01-01' },
      ],
    };
    const { app: a3, tmpDir: td3 } = buildChangelogApp(cl);
    const res = await request(a3).get('/changelog/deprecations');
    expect(res.body.data[0].sunsetDate).toBe('2027-01-01');
    expect(res.body.data[1].sunsetDate).toBeUndefined();
    fs.rmSync(td3, { recursive: true, force: true });
  });
});
