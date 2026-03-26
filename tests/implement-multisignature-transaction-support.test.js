/**
 * Multi-Signature Transaction Support Tests
 *
 * Covers:
 *  - MultiSigService unit tests (creation, signing, auto-submission, error paths)
 *  - HTTP integration tests via the transaction routes
 *
 * No live Stellar network required – uses MockStellarService.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-multisig';

const request = require('supertest');
const express = require('express');

const MultiSigService = require('../src/services/MultiSigService');
const MockStellarService = require('../src/services/MockStellarService');
const Database = require('../src/utils/database');
const transactionRouter = require('../src/routes/transaction');
const { attachUserRole } = require('../src/middleware/rbac');

// ─── helpers ────────────────────────────────────────────────────────────────

const SIGNER_A = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const SIGNER_B = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB4';
const SIGNER_C = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC2';
const VALID_XDR = 'AAAAAQAAAAA='; // minimal placeholder XDR string
const NETWORK = 'Test SDF Network ; September 2015';

function validPayload(overrides = {}) {
  return {
    transaction_xdr: VALID_XDR,
    network_passphrase: NETWORK,
    required_signers: 2,
    signer_keys: [SIGNER_A, SIGNER_B],
    ...overrides,
  };
}

async function clearMultiSigTable() {
  try {
    await Database.run('DELETE FROM multisig_transactions');
  } catch (_) { /* table may not exist in CI before migration */ }
}

// ─── test app ────────────────────────────────────────────────────────────────

function buildApp(stellarService) {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());

  // Override the service used by the router for isolation
  const MultiSigServiceClass = require('../src/services/MultiSigService');
  const svc = new MultiSigServiceClass(stellarService);

  // Mount a fresh router that uses our injected service
  const router = express.Router();

  router.post('/multisig', async (req, res, next) => {
    try {
      const tx = await svc.createMultiSigTransaction(req.body);
      res.status(201).json({ success: true, data: tx });
    } catch (e) { next(e); }
  });

  router.post('/:id/sign', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { signer, signed_xdr } = req.body;
      const tx = await svc.addSignature(id, signer, signed_xdr);
      res.status(200).json({ success: true, data: tx });
    } catch (e) { next(e); }
  });

  router.get('/:id/signatures', async (req, res, next) => {
    try {
      const id = parseInt(req.params.id, 10);
      const data = await svc.getSignatures(id);
      res.status(200).json({ success: true, data });
    } catch (e) { next(e); }
  });

  app.use('/transactions', router);

  app.use((err, req, res, _next) => {
    const status = err.statusCode || err.status || 500;
    res.status(status).json({ success: false, error: { code: err.errorCode || err.code || 'ERROR', message: err.message } });
  });

  return { app, svc };
}

// ─── MultiSigService unit tests ──────────────────────────────────────────────

describe('MultiSigService', () => {
  let service;
  let mock;

  beforeEach(async () => {
    mock = new MockStellarService();
    service = new MultiSigService(mock);
    await clearMultiSigTable();
  });

  // ── constructor ────────────────────────────────────────────────────────────

  test('throws if no stellarService provided', () => {
    expect(() => new MultiSigService()).toThrow('stellarService is required');
  });

  // ── createMultiSigTransaction ──────────────────────────────────────────────

  test('creates a pending transaction with correct fields', async () => {
    const tx = await service.createMultiSigTransaction(validPayload());

    expect(tx.id).toBeGreaterThan(0);
    expect(tx.status).toBe('pending');
    expect(tx.required_signers).toBe(2);
    expect(tx.signer_keys).toEqual([SIGNER_A, SIGNER_B]);
    expect(tx.collected_signatures).toEqual([]);
    expect(tx.stellar_tx_hash).toBeNull();
  });

  test('stores optional metadata', async () => {
    const tx = await service.createMultiSigTransaction(
      validPayload({ metadata: { donationId: 42 } })
    );
    expect(tx.metadata).toEqual({ donationId: 42 });
  });

  test('rejects missing transaction_xdr', async () => {
    await expect(
      service.createMultiSigTransaction(validPayload({ transaction_xdr: '' }))
    ).rejects.toThrow('transaction_xdr is required');
  });

  test('rejects missing network_passphrase', async () => {
    await expect(
      service.createMultiSigTransaction(validPayload({ network_passphrase: '' }))
    ).rejects.toThrow('network_passphrase is required');
  });

  test('rejects required_signers < 2', async () => {
    await expect(
      service.createMultiSigTransaction(validPayload({ required_signers: 1 }))
    ).rejects.toThrow('required_signers must be an integer');
  });

  test('rejects non-integer required_signers', async () => {
    await expect(
      service.createMultiSigTransaction(validPayload({ required_signers: 2.5 }))
    ).rejects.toThrow('required_signers must be an integer');
  });

  test('rejects signer_keys shorter than required_signers', async () => {
    await expect(
      service.createMultiSigTransaction(validPayload({ signer_keys: [SIGNER_A], required_signers: 2 }))
    ).rejects.toThrow('signer_keys must be an array');
  });

  test('rejects duplicate signer_keys', async () => {
    await expect(
      service.createMultiSigTransaction(
        validPayload({ signer_keys: [SIGNER_A, SIGNER_A], required_signers: 2 })
      )
    ).rejects.toThrow('signer_keys must not contain duplicates');
  });

  // ── addSignature ───────────────────────────────────────────────────────────

  test('adds first signature, status stays pending', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    const updated = await service.addSignature(created.id, SIGNER_A, VALID_XDR);

    expect(updated.collected_signatures).toHaveLength(1);
    expect(updated.collected_signatures[0].signer).toBe(SIGNER_A);
    expect(updated.status).toBe('pending');
  });

  test('auto-submits when threshold is met', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    await service.addSignature(created.id, SIGNER_A, VALID_XDR);
    const final = await service.addSignature(created.id, SIGNER_B, VALID_XDR);

    expect(final.status).toBe('submitted');
    expect(final.stellar_tx_hash).toBeTruthy();
  });

  test('rejects signature from unauthorised signer', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    await expect(
      service.addSignature(created.id, SIGNER_C, VALID_XDR)
    ).rejects.toThrow('not an authorised signer');
  });

  test('rejects duplicate signature from same signer', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    await service.addSignature(created.id, SIGNER_A, VALID_XDR);
    await expect(
      service.addSignature(created.id, SIGNER_A, VALID_XDR)
    ).rejects.toThrow('already signed');
  });

  test('rejects signing a non-pending transaction', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    await service.addSignature(created.id, SIGNER_A, VALID_XDR);
    await service.addSignature(created.id, SIGNER_B, VALID_XDR); // submits

    await expect(
      service.addSignature(created.id, SIGNER_A, VALID_XDR)
    ).rejects.toThrow('already');
  });

  test('rejects signing a non-existent transaction', async () => {
    await expect(
      service.addSignature(99999, SIGNER_A, VALID_XDR)
    ).rejects.toThrow('not found');
  });

  test('rejects missing signer', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    await expect(
      service.addSignature(created.id, '', VALID_XDR)
    ).rejects.toThrow('signer public key is required');
  });

  test('rejects missing signed_xdr', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    await expect(
      service.addSignature(created.id, SIGNER_A, '')
    ).rejects.toThrow('signed_xdr is required');
  });

  // ── 3-of-3 threshold ──────────────────────────────────────────────────────

  test('3-of-3: submits only after third signature', async () => {
    const created = await service.createMultiSigTransaction(
      validPayload({ required_signers: 3, signer_keys: [SIGNER_A, SIGNER_B, SIGNER_C] })
    );

    const after1 = await service.addSignature(created.id, SIGNER_A, VALID_XDR);
    expect(after1.status).toBe('pending');

    const after2 = await service.addSignature(created.id, SIGNER_B, VALID_XDR);
    expect(after2.status).toBe('pending');

    const after3 = await service.addSignature(created.id, SIGNER_C, VALID_XDR);
    expect(after3.status).toBe('submitted');
  });

  // ── getSignatures ──────────────────────────────────────────────────────────

  test('getSignatures returns correct counts', async () => {
    const created = await service.createMultiSigTransaction(validPayload());
    await service.addSignature(created.id, SIGNER_A, VALID_XDR);

    const info = await service.getSignatures(created.id);
    expect(info.collected).toHaveLength(1);
    expect(info.required).toBe(2);
    expect(info.remaining).toBe(1);
  });

  test('getSignatures throws for unknown id', async () => {
    await expect(service.getSignatures(99999)).rejects.toThrow('not found');
  });

  // ── submission failure handling ────────────────────────────────────────────

  test('marks transaction as failed when stellar submission fails', async () => {
    mock.enableFailureSimulation('network_error', 1.0);

    const created = await service.createMultiSigTransaction(validPayload());
    await service.addSignature(created.id, SIGNER_A, VALID_XDR);
    const final = await service.addSignature(created.id, SIGNER_B, VALID_XDR);

    expect(final.status).toBe('failed');
    mock.disableFailureSimulation();
  });

  // ── getTransaction ─────────────────────────────────────────────────────────

  test('getTransaction returns null for unknown id', async () => {
    const result = await service.getTransaction(99999);
    expect(result).toBeNull();
  });
});

// ─── HTTP integration tests ──────────────────────────────────────────────────

describe('Multi-Sig HTTP Endpoints', () => {
  let app;
  let mock;

  beforeEach(async () => {
    mock = new MockStellarService();
    ({ app } = buildApp(mock));
    await clearMultiSigTable();
  });

  // ── POST /transactions/multisig ────────────────────────────────────────────

  describe('POST /transactions/multisig', () => {
    test('201 – creates pending transaction', async () => {
      const res = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.id).toBeGreaterThan(0);
    });

    test('400 – missing transaction_xdr', async () => {
      const res = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload({ transaction_xdr: '' }));

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    test('400 – required_signers < 2', async () => {
      const res = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload({ required_signers: 1 }));

      expect(res.status).toBe(400);
    });

    test('400 – duplicate signer_keys', async () => {
      const res = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload({ signer_keys: [SIGNER_A, SIGNER_A] }));

      expect(res.status).toBe(400);
    });
  });

  // ── POST /transactions/:id/sign ────────────────────────────────────────────

  describe('POST /transactions/:id/sign', () => {
    test('200 – first signature accepted, still pending', async () => {
      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      const res = await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.collected_signatures).toHaveLength(1);
    });

    test('200 – second signature triggers auto-submit', async () => {
      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      const res = await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_B, signed_xdr: VALID_XDR });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('submitted');
      expect(res.body.data.stellar_tx_hash).toBeTruthy();
    });

    test('400 – unauthorised signer', async () => {
      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      const res = await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_C, signed_xdr: VALID_XDR });

      expect(res.status).toBe(400);
    });

    test('400 – duplicate signature', async () => {
      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      const res = await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      expect(res.status).toBe(400);
    });

    test('404 – non-existent transaction', async () => {
      const res = await request(app)
        .post('/transactions/99999/sign')
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      expect(res.status).toBe(404);
    });

    test('400 – missing signer field', async () => {
      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      const res = await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signed_xdr: VALID_XDR });

      expect(res.status).toBe(400);
    });
  });

  // ── GET /transactions/:id/signatures ──────────────────────────────────────

  describe('GET /transactions/:id/signatures', () => {
    test('200 – returns signature status', async () => {
      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      const res = await request(app)
        .get(`/transactions/${id}/signatures`)
        .set('x-api-key', 'test-key-multisig');

      expect(res.status).toBe(200);
      expect(res.body.data.collected).toHaveLength(1);
      expect(res.body.data.required).toBe(2);
      expect(res.body.data.remaining).toBe(1);
    });

    test('404 – non-existent transaction', async () => {
      const res = await request(app)
        .get('/transactions/99999/signatures')
        .set('x-api-key', 'test-key-multisig');

      expect(res.status).toBe(404);
    });
  });

  // ── edge cases ─────────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    test('signing an already-submitted transaction returns 4xx', async () => {
      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_B, signed_xdr: VALID_XDR });

      const res = await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    });

    test('stellar failure marks transaction as failed', async () => {
      mock.enableFailureSimulation('network_error', 1.0);

      const create = await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload());

      const { id } = create.body.data;

      await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      const res = await request(app)
        .post(`/transactions/${id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_B, signed_xdr: VALID_XDR });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('failed');

      mock.disableFailureSimulation();
    });

    test('multiple independent transactions are isolated', async () => {
      const tx1 = (await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload())).body.data;

      const tx2 = (await request(app)
        .post('/transactions/multisig')
        .set('x-api-key', 'test-key-multisig')
        .send(validPayload())).body.data;

      expect(tx1.id).not.toBe(tx2.id);

      await request(app)
        .post(`/transactions/${tx1.id}/sign`)
        .set('x-api-key', 'test-key-multisig')
        .send({ signer: SIGNER_A, signed_xdr: VALID_XDR });

      // tx2 should still be untouched
      const sig2 = (await request(app)
        .get(`/transactions/${tx2.id}/signatures`)
        .set('x-api-key', 'test-key-multisig')).body.data;

      expect(sig2.collected).toHaveLength(0);
    });
  });
});
