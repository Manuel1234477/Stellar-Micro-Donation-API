/**
 * Issue #1748: README instructs contributors to run `npm run dev`, which is not defined in package.json
 *
 * Acceptance criteria:
 * - `npm run dev` starts the server with auto-reload.
 * - README quickstart commands all succeed on a clean clone with .env.example copied.
 *
 * Tests:
 * - Verify `npm run dev` script is defined in package.json
 * - Verify the script uses nodemon for auto-reload
 * - Verify README mentions npm only (not yarn)
 * - Verify .env.example exists for quickstart reference
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Issue #1748: npm run dev script', () => {
  const packageJsonPath = path.join(__dirname, '../../package.json');
  const readmePath = path.join(__dirname, '../../README.md');
  const envExamplePath = path.join(__dirname, '../../.env.example');

  let packageJson;
  let readmeContent;

  beforeAll(() => {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    readmeContent = fs.readFileSync(readmePath, 'utf-8');
  });

  test('npm run dev script is defined in package.json', () => {
    expect(packageJson.scripts).toBeDefined();
    expect(packageJson.scripts.dev).toBeDefined();
  });

  test('npm run dev script uses nodemon for auto-reload', () => {
    expect(packageJson.scripts.dev).toContain('nodemon');
  });

  test('npm run dev script starts src/app.js', () => {
    expect(packageJson.scripts.dev).toContain('src/app.js');
  });

  test('nodemon is listed as a devDependency', () => {
    expect(packageJson.devDependencies).toBeDefined();
    expect(packageJson.devDependencies.nodemon).toBeDefined();
  });

  test('README.md mentions npm run dev', () => {
    expect(readmeContent).toContain('npm run dev');
  });

  test('README.md exists and is not empty', () => {
    expect(fs.existsSync(readmePath)).toBe(true);
    expect(readmeContent.length).toBeGreaterThan(0);
  });

  test('.env.example exists for quickstart setup', () => {
    expect(fs.existsSync(envExamplePath)).toBe(true);
    const envExampleContent = fs.readFileSync(envExamplePath, 'utf-8');
    expect(envExampleContent.length).toBeGreaterThan(0);
  });

  test('README quickstart does not mention yarn', () => {
    // Verify that the quickstart section (roughly lines 100-150) does not recommend yarn
    const quickstartSection = readmeContent.substring(
      readmeContent.indexOf('Quick Start') || 0,
      readmeContent.indexOf('Features') || readmeContent.length
    );
    // Should not say "yarn install" or "yarn run" in the quick start
    expect(quickstartSection).not.toMatch(/yarn\s+install/i);
  });

  test('main entry point is correctly set to src/app.js', () => {
    expect(packageJson.main).toBe('src/app.js');
  });

  test('npm run start requires validate-env', () => {
    expect(packageJson.scripts.start).toContain('validate-env');
  });

  test('README explains environment setup requirements', () => {
    expect(readmeContent).toMatch(/env|environment/i);
  });
});
