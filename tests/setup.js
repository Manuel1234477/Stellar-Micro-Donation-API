// Jest setup file - runs before each test file in every worker
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,test-key,admin-test-key';
process.env.NODE_ENV = 'test';
// Fixed test key — must be set before any module that imports securityConfig is loaded
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test_encryption_key_fixed_32bytes_hex_value_here_00';

// ─── Guard: block accidental access to the shared data/ directory ─────────────
// Any test that reads or writes a path under <repo>/data/ without going through
// the env-var-controlled paths is a potential source of flakiness. We intercept
// fs.readFileSync / writeFileSync and throw an actionable error so the problem
// surfaces immediately rather than silently corrupting state.
{
  const fs = require('fs');
  const path = require('path');
  const REPO_DATA_DIR = path.resolve(__dirname, '..', 'data');

  function assertNotSharedData(filePath) {
    if (typeof filePath !== 'string') return;
    const resolved = path.resolve(filePath);
    if (resolved.startsWith(REPO_DATA_DIR + path.sep) || resolved === REPO_DATA_DIR) {
      throw new Error(
        `[TEST ISOLATION] Direct access to ${filePath} is forbidden in tests.\n` +
        'Use process.env.DB_PATH / DB_JSON_PATH / WALLETS_JSON_PATH instead.\n' +
        'Each Jest worker already has a private copy in a temp directory.'
      );
    }
  }

  const _readFileSync = fs.readFileSync.bind(fs);
  fs.readFileSync = function(p, ...args) {
    assertNotSharedData(p);
    return _readFileSync(p, ...args);
  };

  const _writeFileSync = fs.writeFileSync.bind(fs);
  fs.writeFileSync = function(p, ...args) {
    assertNotSharedData(p);
    return _writeFileSync(p, ...args);
  };

  const _appendFileSync = fs.appendFileSync.bind(fs);
  fs.appendFileSync = function(p, ...args) {
    assertNotSharedData(p);
    return _appendFileSync(p, ...args);
  };
}

// ─── Per-worker storage isolation ─────────────────────────────────────────────
// Every Jest worker gets its own SQLite database (copied from the template
// that globalSetup built) and its own JSON/key stores. Without this,
// concurrent workers interleave reads and writes on the same files and
// suites fail in bulk runs that pass in isolation. Must run before any
// src/ module is required: the database layer resolves DB_PATH at load time.
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  const isolationRoot = path.join(os.tmpdir(), 'stellar-test-isolation');
  const workerDir = path.join(isolationRoot, `worker-${process.env.JEST_WORKER_ID || '1'}`);
  fs.mkdirSync(workerDir, { recursive: true });

  const workerDb = path.join(workerDir, 'stellar_donations.db');
  const templateDb = path.join(isolationRoot, 'template.db');
  if (!fs.existsSync(workerDb) && fs.existsSync(templateDb)) {
    fs.copyFileSync(templateDb, workerDb);
  }

  process.env.DB_PATH = workerDb;
  process.env.DB_JSON_PATH = path.join(workerDir, 'donations.json');
  process.env.WALLETS_JSON_PATH = path.join(workerDir, 'wallets.json');
  process.env.MEMO_KEYS_DIR = path.join(workerDir, 'memo-keys');
}

// ─── Reset shared in-memory singletons between test files ────────────────────
// These modules use module-level state that persists across test files in the
// same Jest worker. Resetting them here prevents cross-file contamination.

// 1. Per-key rate limiter — sliding-window store accumulates across files
try {
  const { clearStore } = require('../src/middleware/perKeyRateLimit');
  clearStore();
} catch (_) {}

// 2. Abuse detection service — blocked IPs and suspicious counts persist
try {
  const abuseDetectionService = require('../src/services/AbuseDetectionService');
  abuseDetectionService.blockedIps = [];
  abuseDetectionService.suspiciousCounts = new Map();
} catch (_) {}

// 3. Abuse detector (observability) — request/failure counts persist
try {
  const abuseDetector = require('../src/utils/abuseDetector');
  abuseDetector.requestCounts = new Map();
  abuseDetector.failureCounts = new Map();
  abuseDetector.suspiciousIPs = new Set();
} catch (_) {}

// 4. Replay detection store — nonce/request-id store persists
try {
  const { defaultStore } = require('../src/utils/nonceStore');
  if (defaultStore && typeof defaultStore.clear === 'function') defaultStore.clear();
} catch (_) {}

// 5. Deduplication middleware cache — content-hash cache persists
try {
  const dedup = require('../src/middleware/deduplication');
  if (dedup && typeof dedup.clearCache === 'function') dedup.clearCache();
} catch (_) {}

// 6. Idempotency store — in-memory request record persists across files
try {
  const idempotency = require('../src/middleware/idempotency');
  if (idempotency && typeof idempotency.clearStore === 'function') idempotency.clearStore();
  else if (idempotency && idempotency.store instanceof Map) idempotency.store.clear();
} catch (_) {}

// 7. Feature-flag cache — evaluated flags are cached module-level
try {
  const featureFlags = require('../src/utils/featureFlags');
  if (featureFlags && typeof featureFlags.resetCache === 'function') featureFlags.resetCache();
} catch (_) {}

// ─── Ensure fake timers are always restored after every test ─────────────────
// Time-dependent tests (rate-limit windows, scheduler intervals) that call
// jest.useFakeTimers() must restore real timers on teardown. This afterEach
// acts as a safety net so a test that forgets to call jest.useRealTimers()
// does not leak a fake clock into subsequent tests in the same worker.
if (typeof afterEach === 'function') {
  afterEach(() => {
    // Only restore if fake timers are currently active to avoid a Jest warning
    // when real timers are already in use.
    try {
      jest.useRealTimers();
    } catch (_) {}
  });
}

// Polyfill for legacy test patterns
if (typeof jest !== 'undefined') {
  try {
    Object.defineProperty(jest.fn.prototype, 'resolves', {
      configurable: true,
      value: function(value) {
        return this.mockResolvedValue(value);
      }
    });

    Object.defineProperty(jest.fn.prototype, 'rejects', {
      configurable: true,
      value: function(error) {
        return this.mockRejectedValue(error);
      }
    });
  } catch (_e) {
    // Already defined or read-only — skip silently
  }
}
