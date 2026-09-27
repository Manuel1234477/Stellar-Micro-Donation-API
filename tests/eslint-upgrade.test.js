/**
 * ESLint 9+ Flat Config Tests (Issue #1757)
 *
 * Validates ESLint configuration migration to flat config format and
 * that all local rules and plugins continue to work correctly.
 */

const fs = require('fs');
const path = require('path');

describe('ESLint 9+ Configuration', () => {
  describe('ESLint version and setup', () => {
    let packageJsonContent;

    beforeAll(() => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      packageJsonContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    });

    it('should use ESLint 9.x or higher', () => {
      const eslintVersion = packageJsonContent.devDependencies.eslint;
      const majorVersion = parseInt(eslintVersion.split('.')[0], 10);

      expect(majorVersion).toBeGreaterThanOrEqual(9);
    });

    it('should use flat config format', () => {
      const hasEslintConfigJs = fs.existsSync(path.join(__dirname, '../eslint.config.js'));
      const hasOldEslintrc = fs.existsSync(path.join(__dirname, '../.eslintrc.js'));

      expect(hasEslintConfigJs).toBe(true);
      expect(hasOldEslintrc).toBe(false);
    });
  });

  describe('eslint.config.js validation', () => {
    let configContent;
    let configPath;

    beforeAll(() => {
      configPath = path.join(__dirname, '../eslint.config.js');
      if (fs.existsSync(configPath)) {
        configContent = fs.readFileSync(configPath, 'utf-8');
      }
    });

    it('should have flat config file', () => {
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('should export configuration as default export', () => {
      expect(configContent).toMatch(/module\.exports\s*=|export\s+default/);
    });

    it('should include security plugin configuration', () => {
      expect(configContent).toMatch(/eslint-plugin-security|security\s*:/i);
    });

    it('should include local rules configuration', () => {
      expect(configContent).toMatch(/eslint-plugin-local|local\s*:/i);
    });

    it('should include no-secrets plugin configuration', () => {
      expect(configContent).toMatch(/no-secrets|@michaelorozmahon\/no-secrets/i);
    });
  });

  describe('Local rules plugin migration', () => {
    let eslintRulesDir;

    beforeAll(() => {
      eslintRulesDir = path.join(__dirname, '../eslint-rules');
    });

    it('should maintain eslint-rules directory', () => {
      expect(fs.existsSync(eslintRulesDir)).toBe(true);
    });

    it('should have local rules index file', () => {
      const indexPath = path.join(eslintRulesDir, 'index.js');
      expect(fs.existsSync(indexPath)).toBe(true);
    });

    it('should export all local rules from index', () => {
      const indexPath = path.join(eslintRulesDir, 'index.js');
      const content = fs.readFileSync(indexPath, 'utf-8');

      expect(content).toMatch(/module\.exports|export/);
    });
  });

  describe('Plugin compatibility', () => {
    let packageJsonContent;

    beforeAll(() => {
      const packageJsonPath = path.join(__dirname, '../package.json');
      packageJsonContent = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    });

    it('should have security plugin installed', () => {
      expect(packageJsonContent.devDependencies['eslint-plugin-security']).toBeDefined();
    });

    it('should have no-secrets plugin installed', () => {
      const hasNoSecretsPlugin = packageJsonContent.devDependencies['eslint-plugin-no-secrets'] ||
                                 packageJsonContent.devDependencies['@michaelorozmahon/eslint-plugin-no-secrets'];
      expect(hasNoSecretsPlugin).toBeDefined();
    });

    it('should have local plugin configured', () => {
      expect(packageJsonContent.devDependencies['eslint-plugin-local']).toBeDefined();
    });
  });

  describe('Old configuration cleanup', () => {
    it('should not have legacy .eslintrc.js', () => {
      const legacyPath = path.join(__dirname, '../.eslintrc.js');
      expect(fs.existsSync(legacyPath)).toBe(false);
    });

    it('should not have legacy .eslintrc.json', () => {
      const legacyPath = path.join(__dirname, '../.eslintrc.json');
      expect(fs.existsSync(legacyPath)).toBe(false);
    });

    it('should not have legacy .eslintrc', () => {
      const legacyPath = path.join(__dirname, '../.eslintrc');
      expect(fs.existsSync(legacyPath)).toBe(false);
    });
  });

  describe('ESLint rules configuration', () => {
    let configContent;

    beforeAll(() => {
      const configPath = path.join(__dirname, '../eslint.config.js');
      if (fs.existsSync(configPath)) {
        configContent = fs.readFileSync(configPath, 'utf-8');
      }
    });

    it('should have rules configured', () => {
      expect(configContent).toMatch(/rules\s*:/);
    });

    it('should configure security rules', () => {
      expect(configContent).toMatch(/no-eval|node\//);
    });
  });
});
