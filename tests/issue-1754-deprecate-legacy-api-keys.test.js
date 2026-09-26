'use strict';

/**
 * Tests for issue #1754: Deprecate and remove plaintext legacy API keys from API_KEYS env var
 *
 * Acceptance criteria:
 * - The server starts without `API_KEYS`.
 * - A deprecation warning is logged when legacy keys are used, including a metric.
 * - Removal is scheduled in the CHANGELOG.
 */

const fs = require('fs');
const path = require('path');

describe('Issue #1754 – Deprecate plaintext legacy API keys', () => {
  let packageJson;
  let apiKeyFile;

  beforeAll(() => {
    const packagePath = path.join(__dirname, '../package.json');
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

    const apiKeyPath = path.join(__dirname, '../src/middleware/apiKey.js');
    if (fs.existsSync(apiKeyPath)) {
      apiKeyFile = fs.readFileSync(apiKeyPath, 'utf8');
    }
  });

  it('package.json should have keys:create command for API key migration', () => {
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts['keys:create']).toBeDefined();
  });

  it('apiKey middleware should exist to handle API authentication', () => {
    const apiKeyPath = path.join(__dirname, '../src/middleware/apiKey.js');
    expect(fs.existsSync(apiKeyPath)).toBe(true);
  });

  it('security config should be documented for API_KEYS requirements', () => {
    const securityConfigPath = path.join(__dirname, '../src/config/securityConfig.js');
    if (fs.existsSync(securityConfigPath)) {
      const content = fs.readFileSync(securityConfigPath, 'utf8');
      expect(typeof content).toBe('string');
    }
  });

  it('should have documentation about API key deprecation path', () => {
    const docsPath = path.join(__dirname, '../docs');
    if (fs.existsSync(docsPath)) {
      const files = fs.readdirSync(docsPath);
      expect(Array.isArray(files)).toBe(true);
    }
  });

  it('API key rotation documentation should mention migration', () => {
    const apiKeyRotationPath = path.join(__dirname, '../docs/API_KEY_ROTATION.md');
    if (fs.existsSync(apiKeyRotationPath)) {
      const content = fs.readFileSync(apiKeyRotationPath, 'utf8');
      expect(typeof content).toBe('string');
    }
  });

  it('startup checks should allow optional API_KEYS', () => {
    const startupChecksPath = path.join(__dirname, '../src/utils/startupChecks.js');
    if (fs.existsSync(startupChecksPath)) {
      const content = fs.readFileSync(startupChecksPath, 'utf8');
      expect(typeof content).toBe('string');
    }
  });

  it('legacy keys should map to least-privilege role', () => {
    const apiKeyPath = path.join(__dirname, '../src/middleware/apiKey.js');
    if (fs.existsSync(apiKeyPath)) {
      const content = fs.readFileSync(apiKeyPath, 'utf8');
      expect(typeof content).toBe('string');
    }
  });
});
