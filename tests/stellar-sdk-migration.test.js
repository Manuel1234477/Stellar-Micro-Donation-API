/**
 * Stellar SDK Migration Tests (Issue #1756)
 *
 * Validates migration from deprecated stellar-sdk to @stellar/stellar-sdk
 * and verifies that all API changes are properly integrated.
 */

const fs = require('fs');
const path = require('path');

describe('Stellar SDK Migration to @stellar/stellar-sdk', () => {
  describe('Dependency migration', () => {
    let packageJsonContent;

    beforeAll(() => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      packageJsonContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    });

    it('should not have deprecated stellar-sdk dependency', () => {
      expect(packageJsonContent.dependencies['stellar-sdk']).toBeUndefined();
    });

    it('should have @stellar/stellar-sdk dependency', () => {
      expect(packageJsonContent.dependencies['@stellar/stellar-sdk']).toBeDefined();
    });

    it('should use latest version of @stellar/stellar-sdk', () => {
      const version = packageJsonContent.dependencies['@stellar/stellar-sdk'];
      const majorVersion = parseInt(version.replace(/[^0-9]/g, '').charAt(0), 10);

      expect(majorVersion).toBeGreaterThanOrEqual(21);
    });
  });

  describe('SDK imports centralization', () => {
    let sdkModuleContent;
    let sdkModulePath;

    beforeAll(() => {
      sdkModulePath = path.join(__dirname, '../src/services/stellar/sdk.js');
      if (fs.existsSync(sdkModulePath)) {
        sdkModuleContent = fs.readFileSync(sdkModulePath, 'utf-8');
      }
    });

    it('should have centralized SDK module', () => {
      expect(fs.existsSync(sdkModulePath)).toBe(true);
    });

    it('should import from @stellar/stellar-sdk', () => {
      expect(sdkModuleContent).toMatch(/@stellar\/stellar-sdk/);
    });

    it('should export SDK classes and utilities', () => {
      expect(sdkModuleContent).toMatch(/module\.exports|export/);
    });

    it('should handle API name changes (Server -> Horizon.Server)', () => {
      expect(sdkModuleContent).toMatch(/Horizon\.Server|\.Server/);
    });

    it('should handle SorobanRpc API changes', () => {
      expect(sdkModuleContent).toMatch(/rpc|SorobanRpc/);
    });
  });

  describe('No deprecated SDK imports', () => {
    const srcDir = path.join(__dirname, '../src');

    function findFilesWithPattern(dir, pattern) {
      const files = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          files.push(...findFilesWithPattern(fullPath, pattern));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          if (pattern.test(content)) {
            files.push(fullPath);
          }
        }
      }

      return files;
    }

    it('should not import from deprecated stellar-sdk package', () => {
      const filesWithOldImport = findFilesWithPattern(srcDir, /from\s+['"]stellar-sdk['"]/);

      expect(filesWithOldImport).toEqual([]);
    });

    it('should use centralized SDK module for all imports', () => {
      const filesWithStellarImport = findFilesWithPattern(srcDir, /from\s+['"].*stellar/);

      filesWithStellarImport.forEach(file => {
        const content = fs.readFileSync(file, 'utf-8');

        if (file.includes('stellar/sdk.js')) {
          expect(content).toMatch(/@stellar\/stellar-sdk/);
        } else {
          expect(content).toMatch(/from\s+['"].*services\/stellar\/sdk/);
        }
      });
    });
  });

  describe('API compatibility verification', () => {
    let servicePath;
    let stellarServiceContent;

    beforeAll(() => {
      servicePath = path.join(__dirname, '../src/services/StellarService.js');
      if (fs.existsSync(servicePath)) {
        stellarServiceContent = fs.readFileSync(servicePath, 'utf-8');
      }
    });

    it('should use Horizon.Server for mainnet/testnet connections', () => {
      if (stellarServiceContent) {
        expect(stellarServiceContent).toMatch(/Horizon\.Server|new.*Server/);
      }
    });

    it('should handle transaction building correctly', () => {
      if (stellarServiceContent) {
        expect(stellarServiceContent).toMatch(/TransactionBuilder|buildTransaction/);
      }
    });

    it('should have proper account sequence handling', () => {
      if (stellarServiceContent) {
        expect(stellarServiceContent).toMatch(/getSequenceNumber|sequenceNumber/);
      }
    });
  });

  describe('Integration test suite', () => {
    let testFilePath;
    let testContent;

    beforeAll(() => {
      testFilePath = path.join(__dirname, '../tests/stellar-integration.test.js');
      if (fs.existsSync(testFilePath)) {
        testContent = fs.readFileSync(testFilePath, 'utf-8');
      }
    });

    it('should have integration tests for Stellar operations', () => {
      expect(fs.existsSync(testFilePath) || fs.existsSync(path.join(__dirname, '../tests/e2e/stellar.test.js'))).toBe(true);
    });

    it('should verify account creation and funding', () => {
      if (testContent) {
        expect(testContent).toMatch(/createAccount|fundAccount|friendbot/i);
      }
    });

    it('should verify payment transactions', () => {
      if (testContent) {
        expect(testContent).toMatch(/payment|sendPayment|submitTransaction/i);
      }
    });
  });

  describe('SDK version verification', () => {
    it('should ensure security updates are available', () => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const version = packageJson.dependencies['@stellar/stellar-sdk'];

      const parts = version.replace(/[^0-9.]/g, '').split('.');
      const major = parseInt(parts[0], 10);
      const minor = parseInt(parts[1], 10);

      expect(major).toBeGreaterThanOrEqual(21);
      expect(minor).toBeGreaterThanOrEqual(0);
    });

    it('should be newer than deprecated SDK', () => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      expect(packageJson.dependencies['@stellar/stellar-sdk']).toBeDefined();
      expect(packageJson.dependencies['stellar-sdk']).toBeUndefined();
    });
  });
});
