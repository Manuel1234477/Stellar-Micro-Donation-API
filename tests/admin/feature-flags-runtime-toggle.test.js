'use strict';

/**
 * Tests for runtime feature flag toggle API (#1602)
 *
 * Covers:
 *  - clearCache is exported and functional
 *  - initializeFeatureFlagOverridesTable is exported
 *  - Global toggle persists in DB
 *  - Per-key override takes precedence over global flag
 *  - Precedence order: api_key > environment > global
 *  - Flag state survives cache clear (reloads from DB)
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-ff-runtime-key';
process.env.NODE_ENV = 'test';

const featureFlagsUtil = require('../../src/utils/featureFlags');
const Database = require('../../src/utils/database');

beforeAll(async () => {
  await Database.initialize();
  await featureFlagsUtil.initializeFeatureFlagsTable();
  await featureFlagsUtil.initializeFeatureFlagOverridesTable();
});

afterAll(async () => {
  // Clean up test flags
  await Database.run("DELETE FROM feature_flags WHERE name LIKE 'test-runtime-%'").catch(() => {});
  await Database.close();
});

beforeEach(async () => {
  // Remove any test flags and reset cache between tests
  await Database.run("DELETE FROM feature_flags WHERE name LIKE 'test-runtime-%'").catch(() => {});
  featureFlagsUtil.clearCache();
});

// ─── Export contract ──────────────────────────────────────────────────────────

describe('featureFlags module exports', () => {
  test('exports clearCache function', () => {
    expect(typeof featureFlagsUtil.clearCache).toBe('function');
  });

  test('exports initializeFeatureFlagOverridesTable function', () => {
    expect(typeof featureFlagsUtil.initializeFeatureFlagOverridesTable).toBe('function');
  });

  test('clearCache does not throw', () => {
    expect(() => featureFlagsUtil.clearCache()).not.toThrow();
  });

  test('initializeFeatureFlagOverridesTable returns a Promise', async () => {
    const result = featureFlagsUtil.initializeFeatureFlagOverridesTable();
    expect(result).toBeInstanceOf(Promise);
    await result; // should not reject
  });
});

// ─── Global flag toggle ───────────────────────────────────────────────────────

describe('Global flag toggle (runtime persist)', () => {
  test('setFlag creates a disabled global flag', async () => {
    await featureFlagsUtil.setFlag('test-runtime-off', false, 'global', null, { description: 'off flag' });
    const flag = await featureFlagsUtil.getFlag('test-runtime-off', 'global', null);
    expect(flag).not.toBeNull();
    expect(Boolean(flag.enabled)).toBe(false);
  });

  test('setFlag creates an enabled global flag', async () => {
    await featureFlagsUtil.setFlag('test-runtime-on', true, 'global', null, { description: 'on flag' });
    const flag = await featureFlagsUtil.getFlag('test-runtime-on', 'global', null);
    expect(Boolean(flag.enabled)).toBe(true);
  });

  test('isFeatureEnabled returns true for enabled global flag', async () => {
    await featureFlagsUtil.setFlag('test-runtime-eval', true, 'global', null);
    featureFlagsUtil.clearCache();
    const result = await featureFlagsUtil.isFeatureEnabled('test-runtime-eval');
    expect(result).toBe(true);
  });

  test('isFeatureEnabled returns false for disabled global flag', async () => {
    await featureFlagsUtil.setFlag('test-runtime-eval2', false, 'global', null);
    featureFlagsUtil.clearCache();
    const result = await featureFlagsUtil.isFeatureEnabled('test-runtime-eval2');
    expect(result).toBe(false);
  });

  test('updating a flag changes its state in DB', async () => {
    await featureFlagsUtil.setFlag('test-runtime-toggle', false, 'global', null);
    featureFlagsUtil.clearCache();
    expect(await featureFlagsUtil.isFeatureEnabled('test-runtime-toggle')).toBe(false);

    await featureFlagsUtil.setFlag('test-runtime-toggle', true, 'global', null);
    featureFlagsUtil.clearCache();
    expect(await featureFlagsUtil.isFeatureEnabled('test-runtime-toggle')).toBe(true);
  });

  test('flag state survives cache clear (reloads from DB)', async () => {
    await featureFlagsUtil.setFlag('test-runtime-persist', true, 'global', null);
    featureFlagsUtil.clearCache();

    // After clearing the cache, the next evaluation should hit the DB
    const result = await featureFlagsUtil.isFeatureEnabled('test-runtime-persist');
    expect(result).toBe(true);
  });
});

// ─── Per-key overrides ────────────────────────────────────────────────────────

describe('Per-key override precedence', () => {
  test('per-key override enables flag for specific key when global is disabled', async () => {
    await featureFlagsUtil.setFlag('test-runtime-perkey', false, 'global', null);
    await featureFlagsUtil.setFlagOverrideForKey('test-runtime-perkey', true, 'api-key-123');
    featureFlagsUtil.clearCache();

    // Global disabled
    const globalResult = await featureFlagsUtil.isFeatureEnabled('test-runtime-perkey');
    expect(globalResult).toBe(false);

    // Per-key enabled
    const keyResult = await featureFlagsUtil.isFeatureEnabled('test-runtime-perkey', { apiKeyId: 'api-key-123' });
    expect(keyResult).toBe(true);
  });

  test('per-key override disables flag for specific key when global is enabled', async () => {
    await featureFlagsUtil.setFlag('test-runtime-perkey2', true, 'global', null);
    await featureFlagsUtil.setFlagOverrideForKey('test-runtime-perkey2', false, 'api-key-456');
    featureFlagsUtil.clearCache();

    // Global enabled
    const globalResult = await featureFlagsUtil.isFeatureEnabled('test-runtime-perkey2');
    expect(globalResult).toBe(true);

    // Per-key disabled
    const keyResult = await featureFlagsUtil.isFeatureEnabled('test-runtime-perkey2', { apiKeyId: 'api-key-456' });
    expect(keyResult).toBe(false);
  });

  test('getFlagOverrideForKey retrieves the override record', async () => {
    await featureFlagsUtil.setFlagOverrideForKey('test-runtime-perkey3', true, 'api-key-789');
    const override = await featureFlagsUtil.getFlagOverrideForKey('test-runtime-perkey3', 'api-key-789');
    expect(override).not.toBeNull();
    expect(Boolean(override.enabled)).toBe(true);
    expect(override.scope).toBe('api_key');
    expect(override.scope_value).toBe('api-key-789');
  });

  test('clearFlagOverrideForKey removes the override', async () => {
    await featureFlagsUtil.setFlagOverrideForKey('test-runtime-perkey4', true, 'api-key-abc');
    let override = await featureFlagsUtil.getFlagOverrideForKey('test-runtime-perkey4', 'api-key-abc');
    expect(override).not.toBeNull();

    await featureFlagsUtil.clearFlagOverrideForKey('test-runtime-perkey4', 'api-key-abc');
    override = await featureFlagsUtil.getFlagOverrideForKey('test-runtime-perkey4', 'api-key-abc');
    expect(override).toBeNull();
  });
});

// ─── Precedence order: api_key > environment > global ────────────────────────

describe('Flag evaluation precedence', () => {
  test('api_key scope wins over environment scope', async () => {
    const flagName = 'test-runtime-precedence-1';

    await featureFlagsUtil.setFlag(flagName, false, 'environment', 'production');
    await featureFlagsUtil.setFlag(flagName, true, 'api_key', 'vip-key');
    featureFlagsUtil.clearCache();

    const result = await featureFlagsUtil.isFeatureEnabled(flagName, {
      apiKeyId: 'vip-key',
      environment: 'production',
    });
    expect(result).toBe(true); // api_key override wins
  });

  test('environment scope wins over global scope', async () => {
    const flagName = 'test-runtime-precedence-2';

    await featureFlagsUtil.setFlag(flagName, false, 'global', null);
    await featureFlagsUtil.setFlag(flagName, true, 'environment', 'staging');
    featureFlagsUtil.clearCache();

    const result = await featureFlagsUtil.isFeatureEnabled(flagName, {
      environment: 'staging',
    });
    expect(result).toBe(true); // environment override wins
  });

  test('global scope is used when no api_key or environment override', async () => {
    const flagName = 'test-runtime-precedence-3';

    await featureFlagsUtil.setFlag(flagName, true, 'global', null);
    featureFlagsUtil.clearCache();

    const result = await featureFlagsUtil.isFeatureEnabled(flagName);
    expect(result).toBe(true);
  });

  test('returns defaultValue when flag does not exist', async () => {
    featureFlagsUtil.clearCache();
    const result = await featureFlagsUtil.isFeatureEnabled('test-runtime-nonexistent-flag-xyz', { defaultValue: true });
    expect(result).toBe(true);
  });
});

// ─── getAllFlags and getEffectiveFlagsForKey ──────────────────────────────────

describe('getAllFlags and getEffectiveFlagsForKey', () => {
  test('getAllFlags returns array', async () => {
    const flags = await featureFlagsUtil.getAllFlags();
    expect(Array.isArray(flags)).toBe(true);
  });

  test('getEffectiveFlagsForKey returns map of flag names to booleans', async () => {
    await featureFlagsUtil.setFlag('test-runtime-effective', true, 'global', null);
    featureFlagsUtil.clearCache();

    const effective = await featureFlagsUtil.getEffectiveFlagsForKey('any-key', 'test');
    expect(typeof effective).toBe('object');
    // Our test flag should appear
    expect(Object.keys(effective)).toContain('test-runtime-effective');
    expect(typeof effective['test-runtime-effective']).toBe('boolean');
  });
});
