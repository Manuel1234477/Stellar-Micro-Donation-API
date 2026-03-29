const request = require('supertest');
const StellarSdk = require('stellar-sdk');

describe('SEP-0010 extended authentication', () => {
  let app;
  let clientKeypair;
  let serverKeypair;
  let stellarService;
  const envBackup = {};

  const setEnv = (key, value) => {
    envBackup[key] = process.env[key];
    process.env[key] = value;
  };

  const restoreEnv = () => {
    Object.entries(envBackup).forEach(([key, value]) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  };

  beforeAll(() => {
    setEnv('NODE_ENV', 'test');
    setEnv('USE_MOCK_STELLAR', 'true');
    setEnv('HOME_DOMAIN', 'sep10.example.local');
    setEnv('SEP10_CHALLENGE_TTL', '2');

    serverKeypair = StellarSdk.Keypair.random();
    setEnv('SERVICE_SECRET_KEY', serverKeypair.secret());

    const serviceContainer = require('../../src/config/serviceContainer');
    stellarService = serviceContainer.getStellarService();

    stellarService.wallets.set(serverKeypair.publicKey(), {
      publicKey: serverKeypair.publicKey(),
      secretKey: serverKeypair.secret(),
      balance: '100000000.0000000',
      assetBalances: { native: '100000000.0000000' },
      createdAt: new Date().toISOString(),
      sequence: '1',
    });

    app = require('../../src/routes/app');
    clientKeypair = StellarSdk.Keypair.random();
  });

  afterAll(() => {
    restoreEnv();
  });

  it('GET /auth/challenge returns a SEP-0010 challenge transaction', async () => {
    const res = await request(app)
      .get('/auth/challenge')
      .query({ account: clientKeypair.publicKey() });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.transaction).toBe('string');
    expect(res.body.data.transaction.length).toBeGreaterThan(20);
  });

  it('POST /auth/token verifies challenge and issues JWT', async () => {
    const challengeRes = await request(app)
      .get('/auth/challenge')
      .query({ account: clientKeypair.publicKey() });

    const challengeTx = new StellarSdk.Transaction(challengeRes.body.data.transaction, StellarSdk.Networks.TESTNET);
    challengeTx.sign(clientKeypair);

    const tokenRes = await request(app)
      .post('/auth/token')
      .send({ transaction: challengeTx.toXDR() });

    expect(tokenRes.status).toBe(200);
    expect(tokenRes.body.success).toBe(true);
    expect(tokenRes.body.data.account).toBe(clientKeypair.publicKey());
    expect(typeof tokenRes.body.data.accessToken).toBe('string');

    const jwt = tokenRes.body.data.accessToken;
    const protectedRes = await request(app)
      .post('/api/v1/wallets')
      .set('Authorization', `Bearer ${jwt}`)
      .send({ address: clientKeypair.publicKey(), label: 'SEP10 user' });

    expect([401, 403]).toContain(protectedRes.status);
  });

  it('rejects expired challenges after the configured TTL', async () => {
    const challengeRes = await request(app)
      .get('/auth/challenge')
      .query({ account: clientKeypair.publicKey() });

    await new Promise(resolve => setTimeout(resolve, 2200));

    const challengeTx = new StellarSdk.Transaction(challengeRes.body.data.transaction, StellarSdk.Networks.TESTNET);
    challengeTx.sign(clientKeypair);

    const res = await request(app)
      .post('/auth/token')
      .send({ transaction: challengeTx.toXDR() });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  it('rejects replayed challenges after a successful exchange', async () => {
    const challengeRes = await request(app)
      .get('/auth/challenge')
      .query({ account: clientKeypair.publicKey() });

    const challengeTx = new StellarSdk.Transaction(challengeRes.body.data.transaction, StellarSdk.Networks.TESTNET);
    challengeTx.sign(clientKeypair);
    const signedXdr = challengeTx.toXDR();

    const firstRes = await request(app)
      .post('/auth/token')
      .send({ transaction: signedXdr });

    expect(firstRes.status).toBe(200);

    const replayRes = await request(app)
      .post('/auth/token')
      .send({ transaction: signedXdr });

    expect(replayRes.status).toBe(401);
    expect(replayRes.body.success).toBe(false);
    expect(replayRes.body.error.message).toMatch(/already been used/i);
  });
});
