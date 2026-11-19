'use strict';

/**
 * Issue #1938: federation records can be managed at runtime through
 * /admin/federation, invalid account ids and memos are rejected with 400, and
 * both name and reverse (type=id) lookups are served from the database.
 */

const request = require('supertest');
const express = require('express');
const StellarSdk = require('../../src/services/stellar/sdk.js');
const db = require('../../src/utils/database');
const FederationRecordService = require('../../src/services/FederationRecordService');

const ACCOUNT = StellarSdk.Keypair.random().publicKey();
const ACCOUNT_2 = StellarSdk.Keypair.random().publicKey();
const NAME = 'test1938-alice';
const DOMAIN = 'example.test';

function buildAdminApp(role = 'admin') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.id = 'req-1938';
    req.apiKey = { id: 1, role };
    next();
  });
  app.use('/admin/federation', require('../../src/routes/admin/federation'));
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR' } });
  });
  return app;
}

function buildFederationApp() {
  const app = express();
  app.use('/', require('../../src/routes/federation').router);
  return app;
}

async function cleanup() {
  await db.run('DELETE FROM federation_records WHERE name LIKE ?', ['test1938-%']);
}

describe('FederationRecordService.validateRecord (#1938)', () => {
  it('accepts a valid record and normalises the name', () => {
    const r = FederationRecordService.validateRecord({ name: 'Alice', account_id: ACCOUNT });
    expect(r.valid).toBe(true);
    expect(r.value).toEqual({ name: 'alice', account_id: ACCOUNT, memo_type: null, memo: null });
  });

  it('rejects an account id that is not a valid Ed25519 public key', () => {
    const r = FederationRecordService.validateRecord({ name: 'bob', account_id: 'GNOTAKEY' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/account_id/);
  });

  it('rejects a secret seed in place of an account id', () => {
    const secret = StellarSdk.Keypair.random().secret();
    const r = FederationRecordService.validateRecord({ name: 'bob', account_id: secret });
    expect(r.valid).toBe(false);
  });

  it('enforces memo type and length rules', () => {
    const base = { name: 'memo-check', account_id: ACCOUNT };
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'text', memo: 'x'.repeat(28) }).valid).toBe(true);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'text', memo: 'x'.repeat(29) }).valid).toBe(false);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'id', memo: '18446744073709551615' }).valid).toBe(true);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'id', memo: '18446744073709551616' }).valid).toBe(false);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'id', memo: '12a' }).valid).toBe(false);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'hash', memo: 'a'.repeat(64) }).valid).toBe(true);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'hash', memo: 'short' }).valid).toBe(false);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'bogus', memo: 'x' }).valid).toBe(false);
  });

  it('requires memo and memo_type to be given together', () => {
    const base = { name: 'pair-check', account_id: ACCOUNT };
    expect(FederationRecordService.validateRecord({ ...base, memo: 'orphan' }).valid).toBe(false);
    expect(FederationRecordService.validateRecord({ ...base, memo_type: 'text' }).valid).toBe(false);
  });
});

describe('/admin/federation CRUD (#1938)', () => {
  let admin;

  beforeAll(async () => {
    admin = buildAdminApp();
    await cleanup();
  });

  afterAll(cleanup);

  it('creates a record and returns 201', async () => {
    const res = await request(admin).post('/admin/federation').send({ name: NAME, account_id: ACCOUNT });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ name: NAME, account_id: ACCOUNT, memo_type: null, memo: null });
  });

  it('rejects a duplicate name with 409', async () => {
    const res = await request(admin).post('/admin/federation').send({ name: NAME, account_id: ACCOUNT_2 });
    expect(res.status).toBe(409);
  });

  it('rejects an invalid account id with 400 and stores nothing', async () => {
    const res = await request(admin).post('/admin/federation').send({ name: 'test1938-bad', account_id: 'GBAD' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await FederationRecordService.getByName('test1938-bad')).toBeNull();
  });

  it('rejects an invalid memo with 400', async () => {
    const res = await request(admin).post('/admin/federation').send({
      name: 'test1938-memo', account_id: ACCOUNT, memo_type: 'text', memo: 'x'.repeat(40),
    });
    expect(res.status).toBe(400);
  });

  it('lists records with paging', async () => {
    const res = await request(admin).get('/admin/federation?limit=1&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination).toEqual({ limit: 1, offset: 0 });
  });

  it('rejects out-of-range paging parameters', async () => {
    expect((await request(admin).get('/admin/federation?limit=0')).status).toBe(400);
    expect((await request(admin).get('/admin/federation?limit=201')).status).toBe(400);
    expect((await request(admin).get('/admin/federation?offset=-1')).status).toBe(400);
  });

  it('updates the account id with PATCH', async () => {
    const res = await request(admin).patch(`/admin/federation/${NAME}`).send({ account_id: ACCOUNT_2 });
    expect(res.status).toBe(200);
    expect(res.body.data.account_id).toBe(ACCOUNT_2);
  });

  it('rejects an invalid PATCH and keeps the stored value', async () => {
    const res = await request(admin).patch(`/admin/federation/${NAME}`).send({ account_id: 'GNOPE' });
    expect(res.status).toBe(400);
    const current = await FederationRecordService.getByName(NAME);
    expect(current.account_id).toBe(ACCOUNT_2);
  });

  it('returns 400 for an empty PATCH body', async () => {
    const res = await request(admin).patch(`/admin/federation/${NAME}`).send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown record', async () => {
    expect((await request(admin).get('/admin/federation/test1938-missing')).status).toBe(404);
    expect((await request(admin).patch('/admin/federation/test1938-missing').send({ account_id: ACCOUNT })).status).toBe(404);
    expect((await request(admin).delete('/admin/federation/test1938-missing')).status).toBe(404);
  });

  it('deletes a record', async () => {
    const res = await request(admin).delete(`/admin/federation/${NAME}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
    expect((await request(admin).get(`/admin/federation/${NAME}`)).status).toBe(404);
  });

  it('refuses non-admin callers with 403', async () => {
    const userApp = buildAdminApp('user');
    const res = await request(userApp).get('/admin/federation');
    expect(res.status).toBe(403);
  });
});

describe('federation server reads runtime records (#1938)', () => {
  let admin;
  let federation;

  beforeAll(async () => {
    admin = buildAdminApp();
    federation = buildFederationApp();
    await cleanup();
    await request(admin).post('/admin/federation').send({
      name: NAME, account_id: ACCOUNT, memo_type: 'text', memo: 'donate',
    });
    process.env.FEDERATION_DOMAIN = DOMAIN;
  });

  afterAll(async () => {
    delete process.env.FEDERATION_DOMAIN;
    await cleanup();
  });

  it('resolves a name added at runtime without a restart', async () => {
    const res = await request(federation).get(`/federation?q=${NAME}*${DOMAIN}&type=name`);
    expect(res.status).toBe(200);
    expect(res.body.account_id).toBe(ACCOUNT);
    expect(res.body.memo_type).toBe('text');
    expect(res.body.memo).toBe('donate');
  });

  it('reverse-resolves an account id to its federation address (type=id)', async () => {
    const res = await request(federation).get(`/federation?q=${ACCOUNT}&type=id`);
    expect(res.status).toBe(200);
    expect(res.body.stellar_address).toBe(`${NAME}*${DOMAIN}`);
    expect(res.body.account_id).toBe(ACCOUNT);
    expect(res.body.memo).toBe('donate');
  });

  it('returns 404 for an account with no federation name (type=id)', async () => {
    const res = await request(federation).get(`/federation?q=${ACCOUNT_2}&type=id`);
    expect(res.status).toBe(404);
  });

  it('returns 400 for a malformed account in type=id', async () => {
    const res = await request(federation).get('/federation?q=GNOPE&type=id');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a name after it is deleted', async () => {
    await request(admin).delete(`/admin/federation/${NAME}`);
    const res = await request(federation).get(`/federation?q=${NAME}*${DOMAIN}&type=name`);
    expect(res.status).toBe(404);
  });
});
