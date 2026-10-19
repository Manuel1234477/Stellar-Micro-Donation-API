'use strict';

/**
 * Central env schema (#1784, #1785)
 */

const { ENV_VARS } = require('../../src/config/envSchema');
const { loadEnv, readEnv, isDeclared } = require('../../src/config/env');
const { findUndocumented, checkGeneratedFiles } = require('../../scripts/check-env-documented');

describe('envSchema', () => {
  test('every entry has a name, type, group and description', () => {
    for (const def of ENV_VARS) {
      expect(def.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(['string', 'integer', 'number', 'boolean', 'enum', 'list', 'url', 'json']).toContain(def.type);
      expect(typeof def.group).toBe('string');
      expect(def.description.length).toBeGreaterThan(0);
      if (def.type === 'enum') expect(Array.isArray(def.enum)).toBe(true);
    }
  });

  test('names are unique', () => {
    const names = ENV_VARS.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('defaults satisfy their own type and bounds', () => {
    const { errors } = loadEnv({ API_KEYS: 'k' });
    expect(errors).toEqual([]);
  });
});

describe('loadEnv', () => {
  test('applies types and defaults', () => {
    const { values } = loadEnv({ API_KEYS: 'a, b', SSE_MAX_CONNECTIONS_PER_KEY: '7', CORS_ALLOW_ALL: 'true' });
    expect(values.API_KEYS).toEqual(['a', 'b']);
    expect(values.SSE_MAX_CONNECTIONS_PER_KEY).toBe(7);
    expect(values.CORS_ALLOW_ALL).toBe(true);
    expect(values.SSE_EVENT_BUFFER_SIZE).toBe(100);
    expect(Object.isFrozen(values)).toBe(true);
  });

  test('reports type, range and enum errors', () => {
    const { errors } = loadEnv({
      API_KEYS: 'k',
      PORT: 'abc',
      LOG_SAMPLE_RATE: '2',
      SHARED_STATE_BACKEND: 'memcached',
      DEBUG_MODE: 'maybe',
    });
    expect(errors.some((e) => e.startsWith('PORT must be an integer'))).toBe(true);
    expect(errors.some((e) => e.startsWith('LOG_SAMPLE_RATE'))).toBe(true);
    expect(errors.some((e) => e.startsWith('SHARED_STATE_BACKEND must be one of'))).toBe(true);
    expect(errors.some((e) => e.startsWith('DEBUG_MODE'))).toBe(true);
  });

  test('reports missing required variables', () => {
    expect(loadEnv({}).errors).toContain('API_KEYS is required but was not set.');
    expect(loadEnv({ API_KEYS: 'k', NODE_ENV: 'production' }).errors)
      .toContain('ENCRYPTION_KEY is required but was not set.');
  });

  test('never prints secret values', () => {
    const { errors } = loadEnv({ API_KEYS: 'k', SHARED_STATE_REDIS_URL: 'not a url with password' });
    const msg = errors.find((e) => e.startsWith('SHARED_STATE_REDIS_URL'));
    expect(msg).toContain('<redacted>');
    expect(msg).not.toContain('password');
  });
});

describe('readEnv', () => {
  test('reads the live value with the declared type', () => {
    expect(readEnv('BODY_DEDUP_WINDOW_SECONDS', { BODY_DEDUP_WINDOW_SECONDS: '15' })).toBe(15);
    expect(readEnv('BODY_DEDUP_WINDOW_SECONDS', {})).toBe(60);
  });

  test('falls back to the default for invalid values', () => {
    expect(readEnv('BODY_DEDUP_WINDOW_SECONDS', { BODY_DEDUP_WINDOW_SECONDS: 'soon' })).toBe(60);
  });

  test('rejects undeclared names', () => {
    expect(() => readEnv('NOT_A_REAL_VARIABLE')).toThrow(/not declared/);
  });

  test('accepts names matching a declared pattern', () => {
    expect(isDeclared('ENCRYPTION_KEY_2')).toBe(true);
  });
});

describe('documentation checks', () => {
  test('every process.env read in src/ is declared in the schema', () => {
    expect(findUndocumented()).toEqual([]);
  });

  test('.env.example and docs/CONFIGURATION.md are in sync with the schema', () => {
    expect(checkGeneratedFiles()).toEqual([]);
  });
});
