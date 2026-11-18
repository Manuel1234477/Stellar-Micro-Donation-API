'use strict';

/**
 * Feature flag unification (#1775)
 *
 * Covers:
 *  - Middleware and store read the same state (toggle propagates to all readers)
 *  - Env defaults do not overwrite runtime toggles
 *  - Admin router is mounted once; public read-only router is mounted under /api/v1
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-ff-propagation-key';
process.env.NODE_ENV = 'test';

const featureFlagsUtil = require('../../src/utils/featureFlags');
const featureFlagMiddleware = require('../../src/middleware/featureFlags');
const Database = require('../../src/utils/database');

const FLAG = 'test-propagation-flag';

function runMiddleware(mw, req = {}) {
  return new Promise((resolve) => {
    mw({ path: '/x', method: 'GET', ...req }, {}, (err) => resolve({ err, req }));
  });
}

beforeAll(async () => {
  await Database.initialize();
  await featureFlagsUtil.initializeFeatureFlagsTable();
});

afterAll(async () => {
  await Database.run("DELETE FROM feature_flags WHERE name LIKE 'test-propagation-%'").catch(() => {});
  await Database.close();
});

beforeEach(async () => {
  await Database.run("DELETE FROM feature_flags WHERE name LIKE 'test-propagation-%'").catch(() => {});
  featureFlagsUtil.clearCache();
});

describe('toggle propagation', () => {
  it('a toggle through the store is seen by middleware on the next request', async () => {
    const gate = featureFlagMiddleware.checkFeatureFlag(FLAG);

    await featureFlagsUtil.setFlag(FLAG, false, 'global');
    let result = await runMiddleware(gate);
    expect(result.err).toBeDefined();

    await featureFlagsUtil.setFlag(FLAG, true, 'global');
    result = await runMiddleware(gate);
    expect(result.err).toBeUndefined();
  });

  it('attachFeatureFlags exposes the same values as getEffectiveFlagsForKey', async () => {
    await featureFlagsUtil.setFlag(FLAG, true, 'global');
    const { req } = await runMiddleware(featureFlagMiddleware.attachFeatureFlags(), { apiKey: { id: 'k1' } });
    const effective = await featureFlagsUtil.getEffectiveFlagsForKey('k1', featureFlagsUtil.getDefaultEnvironment());
    expect(req.flags[FLAG]).toBe(true);
    expect(req.flags[FLAG]).toBe(effective[FLAG]);
  });

  it('per-key override wins in middleware too', async () => {
    await featureFlagsUtil.setFlag(FLAG, true, 'global');
    await featureFlagsUtil.setFlagOverrideForKey(FLAG, false, 'k2');
    const { err } = await runMiddleware(featureFlagMiddleware.checkFeatureFlag(FLAG), { apiKey: { id: 'k2' } });
    expect(err).toBeDefined();
  });

  it('evaluated values are booleans', async () => {
    await featureFlagsUtil.setFlag(FLAG, true, 'global');
    await expect(featureFlagsUtil.isFeatureEnabled(FLAG)).resolves.toBe(true);
  });
});

describe('env defaults', () => {
  it('creates missing flags from FEATURE_FLAGS', async () => {
    const summary = await featureFlagsUtil.loadFlagsFromEnv(`${FLAG}=on`);
    expect(summary.created).toContain(FLAG);
    await expect(featureFlagsUtil.isFeatureEnabled(FLAG)).resolves.toBe(true);
  });

  it('does not overwrite a runtime toggle', async () => {
    await featureFlagsUtil.setFlag(FLAG, false, 'global', null, { updatedBy: 'admin' });
    const summary = await featureFlagsUtil.loadFlagsFromEnv(`${FLAG}=true`);
    expect(summary.skipped).toContain(FLAG);
    featureFlagsUtil.clearCache();
    await expect(featureFlagsUtil.isFeatureEnabled(FLAG)).resolves.toBe(false);
  });
});

describe('route mounting', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../src/bootstrap/routes.js'), 'utf8');

  it('mounts the admin feature flag router exactly once', () => {
    const matches = src.match(/require\('\.\.\/routes\/admin\/featureFlags'\)/g) || [];
    expect(matches).toHaveLength(1);
  });

  it('mounts the read-only client router under /api/v1/feature-flags', () => {
    expect(src).toMatch(/\['\/feature-flags',\s+require\('\.\.\/routes\/feature-flags'\)\]/);
  });
});
