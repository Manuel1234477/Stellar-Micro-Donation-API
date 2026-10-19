'use strict';

/**
 * Tests for issue #1886: Legacy API key sunset.
 *
 * Acceptance criteria:
 * - The linked migration document exists and is referenced from the README.
 * - After the configured date, legacy keys are rejected.
 * - A metric shows legacy key usage per hashed key id.
 */

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_SUNSET_DATE,
  getLegacyKeySunsetDate,
  isLegacyKeyDisabled,
} = require('../src/utils/legacyApiKeySunset');
const metrics = require('../src/utils/metrics');

const root = path.join(__dirname, '..');

describe('Issue #1886 – Legacy API key sunset', () => {
  describe('getLegacyKeySunsetDate', () => {
    it('defaults to 2026-12-31 when unset', () => {
      expect(getLegacyKeySunsetDate({})).toBe(DEFAULT_SUNSET_DATE);
      expect(DEFAULT_SUNSET_DATE).toBe('2026-12-31');
    });

    it('uses a valid LEGACY_API_KEYS_DISABLED_AFTER override', () => {
      expect(getLegacyKeySunsetDate({ LEGACY_API_KEYS_DISABLED_AFTER: '2027-06-30' })).toBe('2027-06-30');
    });

    it('ignores malformed or impossible overrides so a typo cannot extend access', () => {
      expect(getLegacyKeySunsetDate({ LEGACY_API_KEYS_DISABLED_AFTER: '2026-13-45' })).toBe(DEFAULT_SUNSET_DATE);
      expect(getLegacyKeySunsetDate({ LEGACY_API_KEYS_DISABLED_AFTER: 'next year' })).toBe(DEFAULT_SUNSET_DATE);
    });
  });

  describe('isLegacyKeyDisabled', () => {
    const env = { LEGACY_API_KEYS_DISABLED_AFTER: '2026-12-31' };

    it('keeps legacy keys enabled through the whole sunset day (UTC)', () => {
      expect(isLegacyKeyDisabled(new Date('2026-12-31T23:59:59.000Z'), env)).toBe(false);
    });

    it('rejects legacy keys from the start of the day after the sunset date', () => {
      expect(isLegacyKeyDisabled(new Date('2027-01-01T00:00:00.000Z'), env)).toBe(true);
    });

    it('accepts legacy keys well before the sunset date', () => {
      expect(isLegacyKeyDisabled(new Date('2026-10-19T12:00:00.000Z'), env)).toBe(false);
    });

    it('honours a sunset date that has already passed', () => {
      expect(
        isLegacyKeyDisabled(new Date('2026-10-19T12:00:00.000Z'), { LEGACY_API_KEYS_DISABLED_AFTER: '2026-01-01' })
      ).toBe(true);
    });
  });

  describe('legacy_api_key_usage_total metric', () => {
    it('is registered on the shared registry with a key_id_hash label', async () => {
      const names = (await metrics.registry.getMetricsAsJSON()).map((m) => m.name);
      expect(names).toContain('legacy_api_key_usage_total');
    });

    it('increments per hashed key id', async () => {
      metrics.legacyApiKeyUsageTotal.reset();
      metrics.recordLegacyKeyUsage('legacy-abc123');
      metrics.recordLegacyKeyUsage('legacy-abc123');
      metrics.recordLegacyKeyUsage('legacy-def456');

      const values = (await metrics.legacyApiKeyUsageTotal.get()).values;
      const byKey = Object.fromEntries(values.map((v) => [v.labels.key_id_hash, v.value]));
      expect(byKey).toEqual({ 'legacy-abc123': 2, 'legacy-def456': 1 });
    });
  });

  describe('documentation', () => {
    it('provides docs/MIGRATION_LEGACY_API_KEYS.md', () => {
      expect(fs.existsSync(path.join(root, 'docs', 'MIGRATION_LEGACY_API_KEYS.md'))).toBe(true);
    });

    it('is linked from the README', () => {
      const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
      expect(readme).toContain('docs/MIGRATION_LEGACY_API_KEYS.md');
    });
  });
});
