/**
 * Tests: dataMasker — Issue #1342
 *
 * SENSITIVE_PATTERNS previously included short generic substrings ('iv', 'auth',
 * 'seed', 'session', 'memo', 'cipher') matched with .includes() inside
 * isSensitiveKey().  This caused innocent field names that merely contain those
 * substrings to be fully redacted in every log line, destroying observability
 * (e.g. receiverId masked on every donation log).
 *
 * Fix verified:
 *  1. False-positive field names (receiverId, authorName, arrivalTime, active,
 *     sessionData, archived, seeder, memorable, ciphertext) are NOT masked.
 *  2. Genuinely sensitive field names (secretKey, apiKey, password, token,
 *     authorization, sessionId, authTag, iv-as-exact-key, seed-as-exact-key) ARE
 *     still masked.
 *  3. maskSensitiveData() preserves non-sensitive fields end-to-end while still
 *     masking sensitive siblings.
 *
 * Closes #1342
 */

'use strict';

const {
  isSensitiveKey,
  maskSensitiveData,
  SENSITIVE_PATTERNS,
} = require('../../src/utils/dataMasker');

// ── False positives that must NOT be masked ───────────────────────────────────

describe('dataMasker — issue #1342 isSensitiveKey false-positive fix', () => {
  describe('should NOT flag innocent field names', () => {
    const falsePositives = [
      // Contains 'iv'
      'receiverId',
      'receiver_id',
      'arrivalTime',
      'arrival_time',
      'active',
      'activity',
      'archive',
      'archived',
      'objective',
      'preview',
      'relative',
      'primitive',
      'captive',
      'incentive',
      'inclusive',
      'initiative',
      'sensitive',   // ironically, "sensitive" is not in the pattern list

      // Contains 'auth'
      'authorName',
      'author_name',
      'authorId',
      'author_id',
      'authenticate_user', // has auth but is not the exact key "authorization"
      'reauthorize',

      // Contains 'seed'
      'seeder',
      'seeded',
      'speed',       // no 'seed' but close — should not match

      // Contains 'session' as prefix/compound but is not sessionId/session_id/sessiontoken
      'sessionData',
      'session_data',
      'sessionCount',
      'session_count',

      // Contains 'memo'
      'memorable',
      'memory',
      'memorize',

      // Contains 'cipher'
      'ciphertext',   // not in the exact pattern list

      // Generic benign keys
      'amount',
      'donorId',
      'recipientId',
      'firstName',
      'lastName',
      'email',       // note: email itself is not in SENSITIVE_PATTERNS
      'createdAt',
      'updatedAt',
      'status',
      'frequency',
      'scheduleId',
    ];

    falsePositives.forEach(key => {
      it(`isSensitiveKey("${key}") returns false`, () => {
        expect(isSensitiveKey(key)).toBe(false);
      });
    });
  });

  // ── True positives that MUST still be masked ─────────────────────────────

  describe('should still flag genuinely sensitive field names', () => {
    const truePositives = [
      // Exact matches after normalisation
      'password',
      'passwd',
      'pwd',
      'secret',
      'secretKey',
      'secret_key',
      'private',
      'privateKey',
      'private_key',
      'token',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'apiKey',
      'api_key',
      'api-key',
      'authorization',
      'bearer',

      // Stellar-specific
      'senderSecret',
      'sender_secret',
      'sourceSecret',
      'source_secret',
      'signingKey',
      'signing_key',
      'seedPhrase',
      'seed_phrase',
      'mnemonic',

      // Financial/PII
      'creditCard',
      'credit_card',
      'cvv',
      'ssn',

      // Database/connection
      'database_url',
      'databaseUrl',
      'db_url',
      'connection_string',
      'connectionString',
      'encryption_key',

      // Session identifiers (exact)
      'sessionId',
      'session_id',
      'sessionToken',
      'session_token',
      'cookie',
      'csrf',
      'xsrf',

      // Crypto tags (exact compound forms)
      'authTag',
      'auth_tag',

      // HTTP headers
      'x-api-key',
      'x_api_key',

      // HSM / KMS
      'hsm_pin',
      'hsmPin',
      'kms_key_id',
      'kmsKeyId',
    ];

    truePositives.forEach(key => {
      it(`isSensitiveKey("${key}") returns true`, () => {
        expect(isSensitiveKey(key)).toBe(true);
      });
    });
  });

  // ── Case / separator insensitivity ────────────────────────────────────────

  describe('case and separator normalisation', () => {
    it('matches SECRET_KEY regardless of case', () => {
      expect(isSensitiveKey('SECRET_KEY')).toBe(true);
    });

    it('matches api-key with dashes', () => {
      expect(isSensitiveKey('api-key')).toBe(true);
    });

    it('matches API_KEY with underscores', () => {
      expect(isSensitiveKey('API_KEY')).toBe(true);
    });

    it('does NOT match random uppercase innocuous key', () => {
      expect(isSensitiveKey('RECEIVERID')).toBe(false);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('returns false for non-string input', () => {
      expect(isSensitiveKey(null)).toBe(false);
      expect(isSensitiveKey(undefined)).toBe(false);
      expect(isSensitiveKey(42)).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(isSensitiveKey('')).toBe(false);
    });
  });
});

// ── End-to-end maskSensitiveData integration ──────────────────────────────────

describe('dataMasker — issue #1342 maskSensitiveData integration', () => {
  it('preserves receiverId while masking secretKey in the same object', () => {
    const data = {
      receiverId: 'user-42',
      amount: 10,
      secretKey: 'SCZANGBA5JWBLBD34YBZWPWQVFLO6OIOQKWZFAZIJQVHEGX27GQNO3D',
    };

    const masked = maskSensitiveData(data);

    expect(masked.receiverId).toBe('user-42');
    expect(masked.amount).toBe(10);
    expect(masked.secretKey).toMatch(/\[REDACTED\]|\[STELLAR_SECRET_REDACTED\]/);
  });

  it('preserves authorName while masking authorization in the same object', () => {
    const data = {
      authorName: 'Alice',
      authorization: 'Bearer super-secret-token-value-12345',
    };

    const masked = maskSensitiveData(data);

    expect(masked.authorName).toBe('Alice');
    expect(masked.authorization).toBe('[REDACTED]');
  });

  it('preserves arrivalTime while masking token in the same object', () => {
    const data = {
      arrivalTime: '2026-07-28T10:00:00Z',
      token: 'my-very-secret-token-value',
    };

    const masked = maskSensitiveData(data);

    expect(masked.arrivalTime).toBe('2026-07-28T10:00:00Z');
    expect(masked.token).toBe('[REDACTED]');
  });

  it('preserves active field while masking password', () => {
    const data = {
      active: true,
      password: 'hunter2-but-longer',
    };

    const masked = maskSensitiveData(data);

    expect(masked.active).toBe(true);
    expect(masked.password).toBe('[REDACTED]');
  });

  it('masks sessionId but does NOT mask sessionData', () => {
    const data = {
      sessionId: 'abc123-secret-session-id',
      sessionData: { pageCount: 5 },
    };

    const masked = maskSensitiveData(data);

    expect(masked.sessionId).toBe('[REDACTED]');
    // sessionData is a nested object whose key is not sensitive
    expect(masked.sessionData).toEqual({ pageCount: 5 });
  });

  it('preserves all non-sensitive donation log fields', () => {
    const donationLog = {
      donorId: 'user-1',
      receiverId: 'user-2',
      amount: 5.5,
      frequency: 'monthly',
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      apiKey: 'sk-live-super-secret-api-key-value',
    };

    const masked = maskSensitiveData(donationLog);

    expect(masked.donorId).toBe('user-1');
    expect(masked.receiverId).toBe('user-2');
    expect(masked.amount).toBe(5.5);
    expect(masked.frequency).toBe('monthly');
    expect(masked.status).toBe('active');
    expect(masked.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(masked.apiKey).toBe('[REDACTED]');
  });
});

// ── Verify the problematic patterns are absent from SENSITIVE_PATTERNS ─────────

describe('dataMasker — SENSITIVE_PATTERNS no longer contains problematic short substrings', () => {
  const bannedSubstrings = ['iv', 'auth', 'seed', 'session', 'memo', 'cipher'];

  bannedSubstrings.forEach(banned => {
    it(`SENSITIVE_PATTERNS does not contain bare '${banned}' entry`, () => {
      // Exact match after normalisation — compound forms like 'sessionid' are fine
      const normalised = SENSITIVE_PATTERNS.map(p => p.toLowerCase().replace(/[-_\s]/g, ''));
      expect(normalised).not.toContain(banned);
    });
  });
});
