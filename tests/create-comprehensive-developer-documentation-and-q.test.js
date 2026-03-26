/**
 * Tests: Comprehensive Developer Documentation and Quickstart Guide (#390)
 *
 * Validates that all required documentation files exist, are non-empty,
 * contain the expected sections, and that the documented API endpoints
 * and quickstart instructions are accurate.
 *
 * No live Stellar network required — uses MockStellarService.
 */

const fs = require('fs');
const path = require('path');

// ─── helpers ────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

/**
 * Reads a documentation file relative to the project root.
 * @param {string} relPath - Path relative to project root
 * @returns {string} File contents
 */
function readDoc(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

/**
 * Checks whether a documentation file exists.
 * @param {string} relPath - Path relative to project root
 * @returns {boolean}
 */
function docExists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

// ─── File existence ──────────────────────────────────────────────────────────

describe('Documentation files exist', () => {
  const requiredDocs = [
    'docs/quickstart.md',
    'docs/architecture.md',
    'docs/api-reference.md',
    'docs/authentication.md',
    'docs/stellar-concepts.md',
    'docs/deployment.md',
    'CONTRIBUTING.md',
    'docs/features/CREATE_COMPREHENSIVE_DEVELOPER_DOCUMENTATION_AND_Q.md',
  ];

  test.each(requiredDocs)('%s exists', (docPath) => {
    expect(docExists(docPath)).toBe(true);
  });

  test.each(requiredDocs)('%s is non-empty', (docPath) => {
    const content = readDoc(docPath);
    expect(content.trim().length).toBeGreaterThan(100);
  });
});

// ─── quickstart.md ───────────────────────────────────────────────────────────

describe('docs/quickstart.md', () => {
  let content;
  beforeAll(() => { content = readDoc('docs/quickstart.md'); });

  it('contains installation instructions', () => {
    expect(content).toMatch(/npm install/i);
  });

  it('contains database initialization step', () => {
    expect(content).toMatch(/init-db/i);
  });

  it('contains server start command', () => {
    expect(content).toMatch(/npm start/i);
  });

  it('references MOCK_STELLAR for offline development', () => {
    expect(content).toMatch(/MOCK_STELLAR/);
  });

  it('includes a health check verification step', () => {
    expect(content).toMatch(/\/health/);
  });

  it('includes a sample donation request', () => {
    expect(content).toMatch(/\/donations/);
  });

  it('references the API reference doc', () => {
    expect(content).toMatch(/api-reference/i);
  });

  it('includes troubleshooting section', () => {
    expect(content).toMatch(/troubleshoot/i);
  });
});

// ─── architecture.md ─────────────────────────────────────────────────────────

describe('docs/architecture.md', () => {
  let content;
  beforeAll(() => { content = readDoc('docs/architecture.md'); });

  it('describes the API layer', () => {
    expect(content).toMatch(/API Layer|Express/i);
  });

  it('describes the service layer', () => {
    expect(content).toMatch(/Service Layer|DonationService/i);
  });

  it('describes the data layer', () => {
    expect(content).toMatch(/SQLite|Data Layer/i);
  });

  it('mentions MockStellarService', () => {
    expect(content).toMatch(/MockStellarService/);
  });

  it('describes the scheduler', () => {
    expect(content).toMatch(/Scheduler|recurring/i);
  });

  it('describes the security model', () => {
    expect(content).toMatch(/Security|API key/i);
  });

  it('describes the request lifecycle', () => {
    expect(content).toMatch(/lifecycle|middleware/i);
  });
});

// ─── api-reference.md ────────────────────────────────────────────────────────

describe('docs/api-reference.md', () => {
  let content;
  beforeAll(() => { content = readDoc('docs/api-reference.md'); });

  const endpoints = [
    'POST /donations',
    'GET /donations',
    'GET /donations/:id',
    'POST /donations/verify',
    'PATCH /donations/:id/status',
    'POST /wallets',
    'GET /wallets',
    'POST /stream/create',
    'GET /stream/schedules',
    'DELETE /stream/schedules/:id',
    'GET /stats/daily',
    'GET /stats/summary',
    'GET /transactions',
    'GET /health',
  ];

  test.each(endpoints)('documents %s', (endpoint) => {
    expect(content).toContain(endpoint);
  });

  it('documents error response format', () => {
    expect(content).toMatch(/success.*false|error response/i);
  });

  it('documents HTTP status codes', () => {
    expect(content).toMatch(/401|403|404|429/);
  });

  it('includes X-API-Key header reference', () => {
    expect(content).toMatch(/X-API-Key/);
  });

  it('includes example request body for POST /donations', () => {
    expect(content).toMatch(/senderPublicKey|recipientPublicKey/);
  });
});

// ─── authentication.md ───────────────────────────────────────────────────────

describe('docs/authentication.md', () => {
  let content;
  beforeAll(() => { content = readDoc('docs/authentication.md'); });

  it('explains X-API-Key header usage', () => {
    expect(content).toMatch(/X-API-Key/);
  });

  it('documents admin role', () => {
    expect(content).toMatch(/admin/i);
  });

  it('documents user role', () => {
    expect(content).toMatch(/\buser\b/i);
  });

  it('documents guest role', () => {
    expect(content).toMatch(/guest/i);
  });

  it('explains key creation command', () => {
    expect(content).toMatch(/keys:create/);
  });

  it('explains key rotation', () => {
    expect(content).toMatch(/rotation|deprecate|revoke/i);
  });

  it('mentions 401 for missing key', () => {
    expect(content).toMatch(/401/);
  });

  it('mentions 403 for insufficient permissions', () => {
    expect(content).toMatch(/403/);
  });

  it('mentions SEP-0010', () => {
    expect(content).toMatch(/SEP-0010/i);
  });
});

// ─── stellar-concepts.md ─────────────────────────────────────────────────────

describe('docs/stellar-concepts.md', () => {
  let content;
  beforeAll(() => { content = readDoc('docs/stellar-concepts.md'); });

  it('explains XLM', () => {
    expect(content).toMatch(/XLM|Lumens/i);
  });

  it('explains Horizon API', () => {
    expect(content).toMatch(/Horizon/i);
  });

  it('explains testnet vs mainnet', () => {
    expect(content).toMatch(/testnet/i);
    expect(content).toMatch(/mainnet/i);
  });

  it('explains public keys', () => {
    expect(content).toMatch(/public key/i);
  });

  it('explains transaction memos', () => {
    expect(content).toMatch(/memo/i);
  });

  it('references MockStellarService for development', () => {
    expect(content).toMatch(/MockStellarService|MOCK_STELLAR/);
  });

  it('explains transaction fees', () => {
    expect(content).toMatch(/fee/i);
  });
});

// ─── deployment.md ───────────────────────────────────────────────────────────

describe('docs/deployment.md', () => {
  let content;
  beforeAll(() => { content = readDoc('docs/deployment.md'); });

  it('covers Docker deployment', () => {
    expect(content).toMatch(/Docker|dockerfile/i);
  });

  it('covers bare metal / VPS deployment', () => {
    expect(content).toMatch(/bare metal|VPS|PM2/i);
  });

  it('covers cloud deployment', () => {
    expect(content).toMatch(/AWS|GCP|Azure|cloud/i);
  });

  it('includes production checklist', () => {
    expect(content).toMatch(/checklist|NODE_ENV=production/i);
  });

  it('documents ENCRYPTION_KEY requirement', () => {
    expect(content).toMatch(/ENCRYPTION_KEY/);
  });

  it('references health check endpoint', () => {
    expect(content).toMatch(/\/health/);
  });

  it('mentions graceful shutdown', () => {
    expect(content).toMatch(/graceful shutdown|SIGTERM/i);
  });

  it('mentions HTTPS', () => {
    expect(content).toMatch(/HTTPS/i);
  });
});

// ─── CONTRIBUTING.md ─────────────────────────────────────────────────────────

describe('CONTRIBUTING.md', () => {
  let content;
  beforeAll(() => { content = readDoc('CONTRIBUTING.md'); });

  it('explains how to fork and create a branch', () => {
    expect(content).toMatch(/fork|branch/i);
  });

  it('documents test requirements', () => {
    expect(content).toMatch(/coverage|npm test/i);
  });

  it('mentions MockStellarService for tests', () => {
    expect(content).toMatch(/MockStellarService|MOCK_STELLAR/);
  });

  it('documents code style / linting', () => {
    expect(content).toMatch(/lint|ESLint/i);
  });

  it('documents JSDoc requirement', () => {
    expect(content).toMatch(/JSDoc/i);
  });

  it('documents PR process', () => {
    expect(content).toMatch(/pull request|PR/i);
  });

  it('documents commit message convention', () => {
    expect(content).toMatch(/feat:|fix:|Conventional Commits/i);
  });

  it('includes security guidelines', () => {
    expect(content).toMatch(/secret|security/i);
  });

  it('documents branch naming convention', () => {
    expect(content).toMatch(/feature\/|fix\//i);
  });

  it('mentions 95% coverage requirement', () => {
    expect(content).toMatch(/95/);
  });
});

// ─── Route file existence (documented endpoints are implemented) ─────────────

describe('Documented route files exist in source', () => {
  const routeFiles = [
    'src/routes/donation.js',
    'src/routes/wallet.js',
    'src/routes/stream.js',
    'src/routes/stats.js',
    'src/routes/transaction.js',
    'src/routes/app.js',
  ];

  test.each(routeFiles)('%s exists', (filePath) => {
    expect(docExists(filePath)).toBe(true);
  });
});

describe('Documented route files contain expected endpoint handlers', () => {
  it('donation.js handles POST /donations', () => {
    const content = readDoc('src/routes/donation.js');
    expect(content).toMatch(/router\.post\s*\(\s*['"`]\/['"`]/);
  });

  it('donation.js handles GET /donations/:id', () => {
    const content = readDoc('src/routes/donation.js');
    expect(content).toMatch(/router\.get\s*\(\s*['"`]\/:id['"`]/);
  });

  it('donation.js handles POST /verify', () => {
    const content = readDoc('src/routes/donation.js');
    expect(content).toMatch(/verify/i);
  });

  it('wallet.js handles wallet routes', () => {
    const content = readDoc('src/routes/wallet.js');
    expect(content).toMatch(/router\.(get|post)/);
  });

  it('stream.js handles recurring donation routes', () => {
    const content = readDoc('src/routes/stream.js');
    expect(content).toMatch(/router\.(get|post|delete)/);
  });

  it('stats.js handles stats routes', () => {
    const content = readDoc('src/routes/stats.js');
    expect(content).toMatch(/router\.get/);
  });

  it('transaction.js handles transaction routes', () => {
    const content = readDoc('src/routes/transaction.js');
    expect(content).toMatch(/router\.(get|post)/);
  });
});

// ─── MockStellarService is available for tests ───────────────────────────────

describe('MockStellarService is available for testing', () => {
  it('MockStellarService file exists', () => {
    expect(docExists('src/services/MockStellarService.js')).toBe(true);
  });

  it('MockStellarService can be required without errors', () => {
    expect(() => require('../src/services/MockStellarService')).not.toThrow();
  });

  it('MockStellarService has sendPayment method', () => {
    const MockStellarService = require('../src/services/MockStellarService');
    const instance = new MockStellarService();
    expect(typeof instance.sendPayment).toBe('function');
  });

  it('MockStellarService has verifyTransaction method', () => {
    const MockStellarService = require('../src/services/MockStellarService');
    const instance = new MockStellarService();
    expect(typeof instance.verifyTransaction).toBe('function');
  });

  it('MockStellarService.sendPayment resolves with a transaction hash', async () => {
    const MockStellarService = require('../src/services/MockStellarService');
    const instance = new MockStellarService();
    const result = await instance.sendPayment(
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      '10.00',
    );
    expect(result).toHaveProperty('hash');
    expect(typeof result.hash).toBe('string');
  });
});
