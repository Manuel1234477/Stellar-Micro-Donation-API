'use strict';

/**
 * Tests: Wallet Field Encryption at Rest (#623)
 *
 * Covers:
 *  - EncryptionService.encryptField / decryptField round-trip
 *  - Key versioning (ENCRYPTION_KEY_VERSION)
 *  - Old-version compatibility during rotation
 *  - Wallet model encrypts label/notes on write, decrypts on read
 *  - Plaintext passthrough when no key configured
 *  - POST /admin/encryption/rotate re-encrypts all records
 *  - Rotation skips already-current-version records
 *  - Rotation handles records encrypted with old key version
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── EncryptionService field-level tests ─────────────────────────────────────

describe('EncryptionService.encryptField / decryptField', () => {
  let svc;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY_1 = 'test-key-version-1-secret';
    process.env.ENCRYPTION_KEY_2 = 'test-key-version-2-secret';
    process.env.ENCRYPTION_KEY_VERSION = '1';
    delete require.cache[require.resolve('../../src/services/EncryptionService')];
    svc = require('../../src/services/EncryptionService');
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY_2;
    delete process.env.ENCRYPTION_KEY_VERSION;
    delete require.cache[require.resolve('../../src/services/EncryptionService')];
  });

  it('encrypts and decrypts a string round-trip', () => {
    const ct = svc.encryptField('hello world');
    expect(ct).not.toBe('hello world');
    expect(svc.decryptField(ct)).toBe('hello world');
  });

  it('ciphertext starts with version prefix', () => {
    const ct = svc.encryptField('test');
    expect(ct).toMatch(/^v1:/);
  });

  it('uses ENCRYPTION_KEY_VERSION from env', () => {
    process.env.ENCRYPTION_KEY_VERSION = '2';
    const ct = svc.encryptField('test');
    expect(ct).toMatch(/^v2:/);
    expect(svc.decryptField(ct)).toBe('test');
  });

  it('explicit keyVersion overrides env', () => {
    process.env.ENCRYPTION_KEY_VERSION = '1';
    const ct = svc.encryptField('test', 2);
    expect(ct).toMatch(/^v2:/);
    expect(svc.decryptField(ct)).toBe('test');
  });

  it('decrypts ciphertext from old key version using correct key', () => {
    const ctV1 = svc.encryptField('old data', 1);
    // Switch to version 2 — old ciphertext should still decrypt
    process.env.ENCRYPTION_KEY_VERSION = '2';
    expect(svc.decryptField(ctV1)).toBe('old data');
  });

  it('returns null/undefined unchanged', () => {
    expect(svc.encryptField(null)).toBeNull();
    expect(svc.encryptField(undefined)).toBeUndefined();
    expect(svc.decryptField(null)).toBeNull();
    expect(svc.decryptField(undefined)).toBeUndefined();
  });

  it('passes through plaintext (no version prefix) on decrypt', () => {
    // Records stored before encryption was enabled
    expect(svc.decryptField('plain text value')).toBe('plain text value');
  });

  it('produces different ciphertext each call (random IV)', () => {
    const ct1 = svc.encryptField('same');
    const ct2 = svc.encryptField('same');
    expect(ct1).not.toBe(ct2);
    expect(svc.decryptField(ct1)).toBe('same');
    expect(svc.decryptField(ct2)).toBe('same');
  });

  it('throws when key version not configured', () => {
    delete process.env.ENCRYPTION_KEY_2;
    expect(() => svc.encryptField('test', 2)).toThrow(/version 2/);
  });

  it('throws on tampered ciphertext', () => {
    const ct = svc.encryptField('data');
    const tampered = ct.slice(0, -4) + 'ffff';
    expect(() => svc.decryptField(tampered)).toThrow();
  });
});

// ─── Wallet model field encryption ───────────────────────────────────────────

describe('Wallet model — field encryption', () => {
  let Wallet;
  let tmpFile;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `wallets-test-${Date.now()}.json`);
    process.env.ENCRYPTION_KEY_1 = 'wallet-test-key-v1';
    process.env.ENCRYPTION_KEY_VERSION = '1';

    // Bust module cache so env changes take effect and use temp file
    delete require.cache[require.resolve('../../src/models/wallet')];
    delete require.cache[require.resolve('../../src/services/EncryptionService')];

    Wallet = require('../../src/models/wallet');
    // Point to temp file
    Wallet._testDbPath = tmpFile;
    const origLoad = Wallet.loadWallets.bind(Wallet);
    const origSave = Wallet.saveWallets.bind(Wallet);
    jest.spyOn(Wallet, 'loadWallets').mockImplementation(() => {
      if (!fs.existsSync(tmpFile)) return [];
      return JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    });
    jest.spyOn(Wallet, 'saveWallets').mockImplementation((data) => {
      fs.writeFileSync(tmpFile, JSON.stringify(data));
    });
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY_VERSION;
    jest.restoreAllMocks();
    delete require.cache[require.resolve('../../src/models/wallet')];
    delete require.cache[require.resolve('../../src/services/EncryptionService')];
  });

  it('stores label encrypted in the file', () => {
    Wallet.create({ address: 'GABC', label: 'My Wallet', id: 'w1' });
    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(raw[0].label).toMatch(/^v1:/);
  });

  it('returns plaintext label on getAll', () => {
    Wallet.create({ address: 'GABC', label: 'My Wallet', id: 'w1' });
    const wallets = Wallet.getAll();
    expect(wallets[0].label).toBe('My Wallet');
  });

  it('returns plaintext label on getById', () => {
    const w = Wallet.create({ address: 'GABC', label: 'Secret Label', id: 'w1' });
    const found = Wallet.getById(w.id);
    expect(found.label).toBe('Secret Label');
  });

  it('returns plaintext label on getByAddress', () => {
    Wallet.create({ address: 'GABC', label: 'Addr Label', id: 'w1' });
    const found = Wallet.getByAddress('GABC');
    expect(found.label).toBe('Addr Label');
  });

  it('encrypts updated label on update', () => {
    const w = Wallet.create({ address: 'GABC', label: 'Old', id: 'w1' });
    Wallet.update(w.id, { label: 'New Label' });
    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(raw[0].label).toMatch(/^v1:/);
    expect(Wallet.getById(w.id).label).toBe('New Label');
  });

  it('handles null label without error', () => {
    const w = Wallet.create({ address: 'GABC', label: null, id: 'w1' });
    expect(Wallet.getById(w.id).label).toBeNull();
  });

  it('passes through plaintext label when no key configured', () => {
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY;
    delete require.cache[require.resolve('../../src/models/wallet')];
    delete require.cache[require.resolve('../../src/services/EncryptionService')];
    Wallet = require('../../src/models/wallet');
    jest.spyOn(Wallet, 'loadWallets').mockReturnValue([]);
    jest.spyOn(Wallet, 'saveWallets').mockImplementation((data) => {
      fs.writeFileSync(tmpFile, JSON.stringify(data));
    });

    Wallet.create({ address: 'GABC', label: 'Plain', id: 'w1' });
    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(raw[0].label).toBe('Plain');
  });
});

// ─── POST /admin/encryption/rotate ───────────────────────────────────────────

describe('POST /admin/encryption/rotate', () => {
  const express = require('express');
  const request = require('supertest');
  let tmpFile;
  let Wallet;

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: 'admin', role: 'admin' }; next(); });
    app.use('/admin/encryption', require('../../src/routes/admin/encryption'));
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 500).json({ success: false, error: { message: err.message } });
    });
    return app;
  }

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `wallets-rotate-${Date.now()}.json`);
    process.env.ENCRYPTION_KEY_1 = 'rotate-key-v1';
    process.env.ENCRYPTION_KEY_2 = 'rotate-key-v2';
    process.env.ENCRYPTION_KEY_VERSION = '1';

    delete require.cache[require.resolve('../../src/models/wallet')];
    delete require.cache[require.resolve('../../src/services/EncryptionService')];
    delete require.cache[require.resolve('../../src/routes/admin/encryption')];

    Wallet = require('../../src/models/wallet');
    jest.spyOn(Wallet, 'loadWallets').mockImplementation(() => {
      if (!fs.existsSync(tmpFile)) return [];
      return JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    });
    jest.spyOn(Wallet, 'saveWallets').mockImplementation((data) => {
      fs.writeFileSync(tmpFile, JSON.stringify(data));
    });
  });

  afterEach(() => {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY_2;
    delete process.env.ENCRYPTION_KEY_VERSION;
    jest.restoreAllMocks();
    ['../src/models/wallet', '../src/services/EncryptionService', '../src/routes/admin/encryption']
      .forEach(m => { try { delete require.cache[require.resolve(m)]; } catch (_) {} });
  });

  it('re-encrypts records with new key version', async () => {
    // Create wallet encrypted with v1
    Wallet.create({ address: 'GABC', label: 'Test Label', id: 'w1' });

    // Switch to v2
    process.env.ENCRYPTION_KEY_VERSION = '2';
    delete require.cache[require.resolve('../../src/routes/admin/encryption')];

    const app = createApp();
    const res = await request(app).post('/admin/encryption/rotate');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rotated).toBeGreaterThanOrEqual(1);
    expect(res.body.data.targetVersion).toBe(2);

    // Verify stored ciphertext is now v2
    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(raw[0].label).toMatch(/^v2:/);

    // Verify decryption still works
    const svc = require('../../src/services/EncryptionService');
    expect(svc.decryptField(raw[0].label)).toBe('Test Label');
  });

  it('skips records already at current version', async () => {
    Wallet.create({ address: 'GABC', label: 'Already v1', id: 'w1' });

    // Rotate to v1 (same version — should skip)
    process.env.ENCRYPTION_KEY_VERSION = '1';
    delete require.cache[require.resolve('../../src/routes/admin/encryption')];

    const app = createApp();
    const res = await request(app).post('/admin/encryption/rotate');

    expect(res.status).toBe(200);
    expect(res.body.data.skipped).toBeGreaterThanOrEqual(1);
    expect(res.body.data.rotated).toBe(0);
  });

  it('re-encrypts plaintext (unencrypted) records', async () => {
    // Write a wallet with plaintext label directly (simulates pre-encryption data)
    fs.writeFileSync(tmpFile, JSON.stringify([{
      id: 'w1', address: 'GABC', label: 'Plaintext Label', deletedAt: null,
    }]));

    process.env.ENCRYPTION_KEY_VERSION = '1';
    delete require.cache[require.resolve('../../src/routes/admin/encryption')];

    const app = createApp();
    const res = await request(app).post('/admin/encryption/rotate');

    expect(res.status).toBe(200);
    expect(res.body.data.rotated).toBeGreaterThanOrEqual(1);

    const raw = JSON.parse(fs.readFileSync(tmpFile, 'utf8'));
    expect(raw[0].label).toMatch(/^v1:/);
  });

  it('skips soft-deleted wallets', async () => {
    fs.writeFileSync(tmpFile, JSON.stringify([{
      id: 'w1', address: 'GABC', label: 'Deleted', deletedAt: new Date().toISOString(),
    }]));

    process.env.ENCRYPTION_KEY_VERSION = '2';
    delete require.cache[require.resolve('../../src/routes/admin/encryption')];

    const app = createApp();
    const res = await request(app).post('/admin/encryption/rotate');

    expect(res.status).toBe(200);
    expect(res.body.data.skipped).toBeGreaterThanOrEqual(1);
    expect(res.body.data.rotated).toBe(0);
  });

  it('returns 401 without admin auth', async () => {
    const app = express();
    app.use(express.json());
    // No user injected — requireAdmin should reject
    app.use('/admin/encryption', require('../../src/routes/admin/encryption'));
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || 401).json({ success: false });
    });

    const res = await request(app).post('/admin/encryption/rotate');
    expect([401, 403]).toContain(res.status);
  });
});

// ─── Migration: encrypt existing plaintext values (#1593) ────────────────────

describe('migrate-wallet-encryption script (#1593)', () => {
  const path = require('path');
  const os   = require('os');
  const fs   = require('fs');

  let tmpDb;

  beforeEach(() => {
    jest.resetModules();
    tmpDb = path.join(os.tmpdir(), `wallet-enc-${Date.now()}.db`);
    process.env.NODE_ENV    = 'test';
    process.env.ENCRYPTION_KEY_1 = 'migration-test-secret-key-version-1';
    process.env.ENCRYPTION_KEY   = 'migration-test-secret-key-version-1';
    process.env.ENCRYPTION_KEY_VERSION = '1';
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY_VERSION;
    jest.resetModules();
  });

  it('encryptWalletFields encrypts plaintext label and notes', () => {
    const { encryptWalletFields, decryptWalletFields } = require('../../src/models/wallet');

    const wallet = { id: 'w1', label: 'My Wallet', notes: 'Some notes' };
    const encrypted = encryptWalletFields(wallet);

    expect(encrypted.label).not.toBe('My Wallet');
    expect(encrypted.notes).not.toBe('Some notes');
    expect(encrypted.label_encrypted).toBe(1);
    expect(encrypted.notes_encrypted).toBe(1);
    expect(encrypted.label).toMatch(/^v\d+:/);
    expect(encrypted.notes).toMatch(/^v\d+:/);
  });

  it('decryptWalletFields restores plaintext from encrypted values', () => {
    const { encryptWalletFields, decryptWalletFields } = require('../../src/models/wallet');

    const wallet = { id: 'w1', label: 'My Wallet', notes: 'Some notes' };
    const encrypted = encryptWalletFields(wallet);
    const decrypted = decryptWalletFields(encrypted);

    expect(decrypted.label).toBe('My Wallet');
    expect(decrypted.notes).toBe('Some notes');
  });

  it('already-encrypted values are not double-encrypted', () => {
    const { encryptWalletFields } = require('../../src/models/wallet');

    const wallet = { id: 'w1', label: 'My Wallet', notes: null };
    const firstPass  = encryptWalletFields(wallet);
    const secondPass = encryptWalletFields(firstPass);

    // The label ciphertext should be the same object (no re-encryption)
    expect(secondPass.label).toBe(firstPass.label);
  });

  it('null fields remain null and flag stays 0', () => {
    const { encryptWalletFields } = require('../../src/models/wallet');

    const wallet = { id: 'w1', label: null, notes: null };
    const encrypted = encryptWalletFields(wallet);

    expect(encrypted.label).toBeNull();
    expect(encrypted.notes).toBeNull();
    expect(encrypted.label_encrypted).toBe(0);
    expect(encrypted.notes_encrypted).toBe(0);
  });

  it('DB row contains ciphertext, not plaintext, after create', async () => {
    const Database = require('../../src/utils/database');

    // Spy on Database.run to capture the INSERT values
    const runSpy = jest.spyOn(Database, 'run').mockResolvedValue({ lastID: 1, changes: 1 });
    jest.spyOn(Database, 'all').mockResolvedValue([
      { name: 'id' }, { name: 'address' }, { name: 'label' }, { name: 'notes' },
      { name: 'label_encrypted' }, { name: 'notes_encrypted' },
      { name: 'leaderboard_visibility' }, { name: 'last_synced_at' }, { name: 'last_cursor' },
      { name: 'createdAt' }, { name: 'updatedAt' }, { name: 'deletedAt' },
      { name: 'donation_limit_min' }, { name: 'donation_limit_max' }, { name: 'sdg_tags' },
      { name: 'ownerName' },
    ]);
    jest.spyOn(Database, 'get').mockResolvedValue(null);

    const Wallet = require('../../src/models/wallet');
    await Wallet.create({ address: 'GTEST', label: 'Plaintext Label', notes: 'Plaintext Notes' });

    // Find the INSERT call
    const insertCall = runSpy.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO wallets'));
    expect(insertCall).toBeDefined();

    const args = insertCall[1];
    // label is at index 2, notes at index 4 in the INSERT params
    const labelArg = args[2];
    const notesArg = args[4];

    expect(labelArg).toMatch(/^v\d+:/);
    expect(notesArg).toMatch(/^v\d+:/);
    expect(labelArg).not.toBe('Plaintext Label');
    expect(notesArg).not.toBe('Plaintext Notes');

    runSpy.mockRestore();
  });
});

// ─── Re-encryption on key rotation (#1593) ────────────────────────────────────

describe('Re-encryption on key rotation (#1593)', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY_1 = 'old-key-v1-secret';
    process.env.ENCRYPTION_KEY_2 = 'new-key-v2-secret';
    process.env.ENCRYPTION_KEY_VERSION = '1';
    delete require.cache[require.resolve('../../src/services/EncryptionService')];
  });

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY_2;
    delete process.env.ENCRYPTION_KEY_VERSION;
    delete require.cache[require.resolve('../../src/services/EncryptionService')];
  });

  it('re-encrypts a v1 ciphertext to v2 correctly', () => {
    const svc = require('../../src/services/EncryptionService');

    // Encrypt with v1
    process.env.ENCRYPTION_KEY_VERSION = '1';
    const ct1 = svc.encryptField('sensitive-data');
    expect(ct1).toMatch(/^v1:/);

    // Decrypt with v1, re-encrypt with v2
    const plaintext = svc.decryptField(ct1);
    process.env.ENCRYPTION_KEY_VERSION = '2';
    const ct2 = svc.encryptField(plaintext, 2);
    expect(ct2).toMatch(/^v2:/);

    // Verify round-trip
    const restored = svc.decryptField(ct2);
    expect(restored).toBe('sensitive-data');
  });

  it('decryptField reads key version from ciphertext prefix', () => {
    const svc = require('../../src/services/EncryptionService');

    process.env.ENCRYPTION_KEY_VERSION = '1';
    const ct = svc.encryptField('hello');
    expect(ct).toMatch(/^v1:/);

    process.env.ENCRYPTION_KEY_VERSION = '2';
    // Should still decrypt using v1 key
    const result = svc.decryptField(ct);
    expect(result).toBe('hello');
  });

  it('different plaintexts produce different ciphertexts (IV randomness)', () => {
    const svc = require('../../src/services/EncryptionService');
    process.env.ENCRYPTION_KEY_VERSION = '1';

    const ct1 = svc.encryptField('same-value');
    const ct2 = svc.encryptField('same-value');
    // Random IV means ciphertexts differ even for same plaintext
    expect(ct1).not.toBe(ct2);
    // But both decrypt correctly
    expect(svc.decryptField(ct1)).toBe('same-value');
    expect(svc.decryptField(ct2)).toBe('same-value');
  });

  it('throws when key version is missing', () => {
    const svc = require('../../src/services/EncryptionService');
    delete process.env.ENCRYPTION_KEY_1;
    delete process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY_VERSION = '1';

    expect(() => svc.encryptField('test')).toThrow(/No encryption key configured/);
  });
});
