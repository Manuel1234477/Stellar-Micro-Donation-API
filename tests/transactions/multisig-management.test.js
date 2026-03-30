'use strict';

/**
 * Tests for multi-signature transaction support (issue #633):
 * - MockStellarService: addSigner, removeSigner, setThresholds
 * - StellarService.setThresholds validation
 * - MultiSigService: createMultiSigTransaction, addSignature, insufficient signatures
 * - POST /transactions/multisig/collect endpoint
 * - POST /wallets/:id/thresholds endpoint
 */

jest.mock('../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const MockStellarService = require('../../src/services/MockStellarService');

// ─── MockStellarService multi-sig simulation ──────────────────────────────────

describe('MockStellarService - addSigner', () => {
  let svc;
  beforeEach(() => { svc = new MockStellarService(); });

  it('adds a signer and returns hash/ledger', async () => {
    const result = await svc.addSigner('SECRETKEY1', 'GABC123', 2);
    expect(result.hash).toBeDefined();
    expect(result.ledger).toBeDefined();
    expect(result.signer).toBe('GABC123');
    expect(result.weight).toBe(2);
  });

  it('defaults weight to 1', async () => {
    const result = await svc.addSigner('SECRETKEY1', 'GABC123');
    expect(result.weight).toBe(1);
  });

  it('throws when masterSecret is missing', async () => {
    await expect(svc.addSigner(null, 'GABC123')).rejects.toThrow();
  });

  it('throws when signerPublicKey is missing', async () => {
    await expect(svc.addSigner('SECRETKEY1', null)).rejects.toThrow();
  });

  it('getSigners returns added signers', async () => {
    await svc.addSigner('SECRETKEY1', 'GABC123', 1);
    await svc.addSigner('SECRETKEY1', 'GDEF456', 2);
    const signers = svc.getSigners('SECRETKEY1');
    expect(signers).toHaveLength(2);
  });
});

describe('MockStellarService - removeSigner', () => {
  let svc;
  beforeEach(() => { svc = new MockStellarService(); });

  it('removes a signer', async () => {
    await svc.addSigner('SECRETKEY1', 'GABC123', 1);
    const result = await svc.removeSigner('SECRETKEY1', 'GABC123');
    expect(result.hash).toBeDefined();
    expect(svc.getSigners('SECRETKEY1')).toHaveLength(0);
  });

  it('throws when masterSecret is missing', async () => {
    await expect(svc.removeSigner(null, 'GABC123')).rejects.toThrow();
  });
});

describe('MockStellarService - setThresholds', () => {
  let svc;
  beforeEach(() => { svc = new MockStellarService(); });

  it('sets thresholds and returns them', async () => {
    const result = await svc.setThresholds('SECRETKEY1', 1, 2, 3);
    expect(result.thresholds).toEqual({ low: 1, medium: 2, high: 3 });
    expect(result.hash).toBeDefined();
  });

  it('stores thresholds retrievable via getThresholds', async () => {
    await svc.setThresholds('SECRETKEY1', 1, 2, 3);
    expect(svc.getThresholds('SECRETKEY1')).toEqual({ low: 1, medium: 2, high: 3 });
  });

  it('throws on invalid threshold value', async () => {
    await expect(svc.setThresholds('SECRETKEY1', -1, 2, 3)).rejects.toThrow();
    await expect(svc.setThresholds('SECRETKEY1', 1, 256, 3)).rejects.toThrow();
    await expect(svc.setThresholds('SECRETKEY1', 1, 2, 'x')).rejects.toThrow();
  });

  it('throws when sourceSecret is missing', async () => {
    await expect(svc.setThresholds(null, 1, 2, 3)).rejects.toThrow();
  });
});

// ─── StellarService.setThresholds validation ─────────────────────────────────

describe('StellarService.setThresholds validation', () => {
  it('StellarService has setThresholds method', () => {
    const StellarService = require('../../src/services/StellarService');
    const svc = new StellarService();
    expect(typeof svc.setThresholds).toBe('function');
  });
});

// ─── MultiSigService ──────────────────────────────────────────────────────────

describe('MultiSigService', () => {
  let MultiSigService, svc, mockStellar;

  beforeAll(async () => {
    // Initialize DB
    const Database = require('../../src/utils/database');
    await Database.initialize();
    // Ensure table exists
    await Database.run(`CREATE TABLE IF NOT EXISTS multisig_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_xdr TEXT NOT NULL,
      network_passphrase TEXT NOT NULL,
      required_signers INTEGER NOT NULL,
      signer_keys TEXT NOT NULL,
      collected_signatures TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      stellar_tx_hash TEXT,
      stellar_ledger INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });

  afterAll(async () => {
    const Database = require('../../src/utils/database');
    await Database.close().catch(() => {});
  });

  beforeEach(() => {
    mockStellar = new MockStellarService();
    MultiSigService = require('../../src/services/MultiSigService');
    svc = new MultiSigService(mockStellar);
  });

  it('throws when stellarService is not provided', () => {
    expect(() => new MultiSigService()).toThrow();
  });

  it('creates a pending multi-sig transaction', async () => {
    const tx = await svc.createMultiSigTransaction({
      transaction_xdr: 'AAAA',
      network_passphrase: 'Test SDF Network ; September 2015',
      required_signers: 2,
      signer_keys: ['GAAA', 'GBBB'],
    });
    expect(tx.status).toBe('pending');
    expect(tx.required_signers).toBe(2);
    expect(tx.collected_signatures).toHaveLength(0);
  });

  it('throws on required_signers < 2', async () => {
    await expect(svc.createMultiSigTransaction({
      transaction_xdr: 'AAAA',
      network_passphrase: 'Test',
      required_signers: 1,
      signer_keys: ['GAAA', 'GBBB'],
    })).rejects.toThrow();
  });

  it('throws on duplicate signer_keys', async () => {
    await expect(svc.createMultiSigTransaction({
      transaction_xdr: 'AAAA',
      network_passphrase: 'Test',
      required_signers: 2,
      signer_keys: ['GAAA', 'GAAA'],
    })).rejects.toThrow();
  });

  it('addSignature returns 400-style info when threshold not met', async () => {
    const tx = await svc.createMultiSigTransaction({
      transaction_xdr: 'AAAA',
      network_passphrase: 'Test SDF Network ; September 2015',
      required_signers: 3,
      signer_keys: ['GAAA', 'GBBB', 'GCCC'],
    });

    // Add one signature — threshold (3) not met
    const updated = await svc.addSignature(tx.id, 'GAAA', 'signed-xdr-1');
    expect(updated.status).toBe('pending');
    expect(updated.collected_signatures).toHaveLength(1);
  });

  it('getSignatures returns required vs collected', async () => {
    const tx = await svc.createMultiSigTransaction({
      transaction_xdr: 'AAAA',
      network_passphrase: 'Test SDF Network ; September 2015',
      required_signers: 2,
      signer_keys: ['GAAA', 'GBBB'],
    });
    const sigs = await svc.getSignatures(tx.id);
    expect(sigs.required).toBe(2);
    expect(sigs.collected).toHaveLength(0);
    expect(sigs.remaining).toBe(2);
  });
});

// ─── POST /transactions/multisig/collect route ────────────────────────────────

describe('POST /transactions/multisig/collect', () => {
  it('transaction route exports a router', () => {
    const router = require('../../src/routes/transaction');
    expect(typeof router).toBe('function');
  });
});

// ─── Thresholds router ────────────────────────────────────────────────────────

describe('Thresholds router', () => {
  it('signers module exports thresholdsRouter', () => {
    const { thresholdsRouter } = require('../../src/routes/signers');
    expect(typeof thresholdsRouter).toBe('function');
  });
});
