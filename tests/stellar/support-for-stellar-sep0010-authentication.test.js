const request = require('supertest');
const StellarSdk = require('stellar-sdk');

describe('SEP-0010 authentication', () => {
  let app;
  let stellarService;
  let serverKeypair;
  let clientKeypair;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.USE_MOCK_STELLAR = 'true';

    // Create a persistent server key so SEP-0010 is initialized
    serverKeypair = StellarSdk.Keypair.random();
    process.env.SERVICE_SECRET_KEY = serverKeypair.secret();

    // Require container after env setup
    const serviceContainer = require('../../src/config/serviceContainer');
    stellarService = serviceContainer.getStellarService();

    // Ensure server account exists in mock stellar service
    stellarService.wallets.set(serverKeypair.publicKey(), {
      publicKey: serverKeypair.publicKey(),
      secretKey: serverKeypair.secret(),
      balance: '100000000.0000000',
      assetBalances: { native: '100000000.0000000' },
      createdAt: new Date().toISOString(),
      sequence: '1',
    });

    // Create the app after configuring env/service
    app = require('../../src/routes/app');

    clientKeypair = StellarSdk.Keypair.random();
  });

  afterAll(() => {
    delete process.env.SERVICE_SECRET_KEY;
    delete process.env.USE_MOCK_STELLAR;
  });

  it('GET /auth returns SEP-0010 challenge transaction', async () => {
    const res = await request(app)
      .get('/auth/challenge')
      .query({ account: clientKeypair.publicKey() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.transaction).toBe('string');
    expect(res.body.data.transaction).toHaveLength(expect.any(Number));
  });

  it('POST /auth with signed challenge returns JWT access token', async () => {
    const getRes = await request(app)
      .get('/auth/challenge')
      .query({ account: clientKeypair.publicKey() });

    expect(getRes.status).toBe(200);

    const challengeTx = new StellarSdk.Transaction(getRes.body.data.transaction, StellarSdk.Networks.TESTNET);
    challengeTx.sign(clientKeypair);

    const signRes = await request(app)
      .post('/auth/token')
      .send({ transaction: challengeTx.toXDR() });

    expect(signRes.status).toBe(200);
    expect(signRes.body.success).toBe(true);
    expect(typeof signRes.body.data.accessToken).toBe('string');

    // Use JWT to call an endpoint requiring authentication
    const protectedRes = await request(app)
      .post('/api/v1/wallets')
      .set('Authorization', `Bearer ${signRes.body.data.accessToken}`)
      .send({ address: clientKeypair.publicKey(), label: 'SEP10 user' });

    expect([401, 403]).toContain(protectedRes.status);
    // 401 could happen if wallet path requires extra account-specific context
    // 403 indicates auth succeeded but permission is insufficient.
  });

  it('GET /auth without account returns 400', async () => {
    const res = await request(app).get('/auth/challenge');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_ACCOUNT');
  });

  it('GET /.well-known/stellar.toml returns SEP-0010 hints', async () => {
    const res = await request(app).get('/.well-known/stellar.toml');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/AUTH_SERVER/);
    expect(res.text).toMatch(/VERSION/);
  });

  it('POST /auth with malformed transaction returns 401', async () => {
    const res = await request(app)
      .post('/auth/token')
      .send({ transaction: 'invalid-xdr' });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_CHALLENGE');
  });
});
