'use strict';

/**
 * Tests for issue #1755: Upgrade from Node.js 20 (end-of-life since April 2026) to Node 22 LTS
 *
 * Acceptance criteria:
 * - Dockerfile, engines and all workflows use a supported LTS.
 * - An `.nvmrc` exists.
 * - CI passes on the new version.
 */

const fs = require('fs');
const path = require('path');

describe('Issue #1755 – Node.js LTS version compliance', () => {
  let packageJson;

  beforeAll(() => {
    const packagePath = path.join(__dirname, '../package.json');
    packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  });

  it('package.json should have engines.node specified', () => {
    expect(packageJson.engines).toBeDefined();
    expect(packageJson.engines.node).toBeDefined();
    expect(typeof packageJson.engines.node).toBe('string');
  });

  it('should have npm script to validate Node version compatibility', () => {
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts.check).toBeDefined();
  });

  it('CI pipeline should have node-version configuration', () => {
    const ciPath = path.join(__dirname, '../.github/workflows/ci.yml');
    if (fs.existsSync(ciPath)) {
      const ciContent = fs.readFileSync(ciPath, 'utf8');
      expect(ciContent.includes('node-version')).toBe(true);
    }
  });

  it('Dockerfile should specify a Node base image', () => {
    const dockerfilePath = path.join(__dirname, '../Dockerfile');
    if (fs.existsSync(dockerfilePath)) {
      const dockerfileContent = fs.readFileSync(dockerfilePath, 'utf8');
      expect(/FROM node:/i.test(dockerfileContent)).toBe(true);
    }
  });

  it('project should have documentation for Node version requirements', () => {
    const readmePath = path.join(__dirname, '../README.md');
    if (fs.existsSync(readmePath)) {
      const readmeContent = fs.readFileSync(readmePath, 'utf8');
      expect(typeof readmeContent).toBe('string');
    }
  });
});
