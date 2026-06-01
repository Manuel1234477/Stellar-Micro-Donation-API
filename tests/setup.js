// Jest setup file - runs before each test file in every worker
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,test-key,admin-test-key';
process.env.NODE_ENV = 'test';
// Fixed test key — must be set before any module that imports securityConfig is loaded
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test_encryption_key_fixed_32bytes_hex_value_here_00';

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
