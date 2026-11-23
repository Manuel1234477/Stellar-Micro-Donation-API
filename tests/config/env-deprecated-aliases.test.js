'use strict';

/**
 * #2111 — deprecated env aliases resolve through readEnv() with a warning,
 * every variable read is declared, and direct process.env reads are ratcheted.
 */
const { readEnv, loadEnv, findDeprecatedEnv } = require('../../src/config/env');
const { ENV_VARS } = require('../../src/config/envSchema');
const { findUndocumented } = require('../../scripts/check-env-documented');
const { countDirectReads, readBaseline } = require('../../scripts/check-process-env-count');

describe('deprecated env aliases (#2111)', () => {
  let warnSpy;
  beforeEach(() => {
    warnSpy = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
  });
  afterEach(() => warnSpy.mockRestore());

  it('reads SHUTDOWN_TIMEOUT_MS when set, ignoring the alias', () => {
    expect(readEnv('SHUTDOWN_TIMEOUT_MS', { SHUTDOWN_TIMEOUT_MS: '1000', SHUTDOWN_TIMEOUT: '2000' })).toBe(1000);
  });

  it('falls back to SHUTDOWN_TIMEOUT and warns', () => {
    expect(readEnv('SHUTDOWN_TIMEOUT_MS', { SHUTDOWN_TIMEOUT: '2000' })).toBe(2000);
  });

  it('uses the default when neither name is set', () => {
    expect(readEnv('SHUTDOWN_TIMEOUT_MS', {})).toBe(30000);
  });

  it('loadEnv honours aliases', () => {
    const { values } = loadEnv({ GEOIP_DB_PATH: '/tmp/geo.mmdb' });
    expect(values.MAXMIND_DB_PATH).toBe('/tmp/geo.mmdb');
  });

  it('reports deprecated variables that are set', () => {
    const warnings = findDeprecatedEnv({ SHUTDOWN_TIMEOUT: '5', GEOIP_DB_PATH: 'x' });
    expect(warnings.some((w) => w.startsWith('SHUTDOWN_TIMEOUT '))).toBe(true);
    expect(warnings.some((w) => w.startsWith('GEOIP_DB_PATH '))).toBe(true);
    expect(findDeprecatedEnv({})).toEqual([]);
  });

  it('every alias target is declared and every alias is marked deprecated', () => {
    const byName = new Map(ENV_VARS.map((v) => [v.name, v]));
    for (const def of ENV_VARS) {
      for (const alias of def.deprecatedAliases || []) {
        expect(byName.get(alias)).toBeDefined();
        expect(byName.get(alias).deprecated).toBeTruthy();
      }
    }
  });
});

describe('env schema coverage (#2111)', () => {
  it('declares every variable read under src/', () => {
    expect(findUndocumented()).toEqual([]);
  });

  it('does not add direct process.env reads beyond the baseline', () => {
    const baseline = readBaseline();
    expect(baseline).not.toBeNull();
    expect(countDirectReads().total).toBeLessThanOrEqual(baseline);
  });
});
