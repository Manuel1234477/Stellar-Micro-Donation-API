/**
 * Tests for resource ownership enforcement (Issue #1883)
 *
 * A caller must not be able to modify or delete wallets, channels or
 * recurring schedules owned by another principal. Cross-owner access
 * returns 404 to avoid leaking resource existence.
 */

const request = require('supertest');
const express = require('express');

const { requireOwnership } = require('../../src/middleware/requireOwnership');

const resources = {
  'wallet-a': { id: 'wallet-a', ownerId: 'key-a', label: 'A' },
  'wallet-b': { id: 'wallet-b', ownerId: 'key-b', label: 'B' },
};

const loadWallet = jest.fn(async (id) => resources[id] || null);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = JSON.parse(req.headers['x-test-user'] || '{}');
    next();
  });
  app.patch(
    '/wallets/:id/label',
    requireOwnership(loadWallet),
    (req, res) => res.json({ success: true, data: { id: req.params.id } })
  );
  app.delete(
    '/wallets/:id',
    requireOwnership(loadWallet),
    (req, res) => res.json({ success: true })
  );
  return app;
}

describe('Resource ownership (#1883)', () => {
  const keyA = { id: 'key-a', role: 'user' };
  const admin = { id: 'key-admin', role: 'admin' };

  beforeEach(() => {
    loadWallet.mockClear();
  });

  test('owner can modify their own wallet', async () => {
    const res = await request(buildApp())
      .patch('/wallets/wallet-a/label')
      .set('x-test-user', JSON.stringify(keyA))
      .send({ label: 'new' });

    expect(res.status).toBe(200);
  });

  test('non-owner gets 404 when modifying another key\'s wallet', async () => {
    const res = await request(buildApp())
      .patch('/wallets/wallet-b/label')
      .set('x-test-user', JSON.stringify(keyA))
      .send({ label: 'hijack' });

    expect(res.status).toBe(404);
  });

  test('non-owner gets 404 when deleting another key\'s wallet', async () => {
    const res = await request(buildApp())
      .delete('/wallets/wallet-b')
      .set('x-test-user', JSON.stringify(keyA));

    expect(res.status).toBe(404);
  });

  test('unknown resource returns 404 with the same response as a foreign resource', async () => {
    const app = buildApp();
    const missing = await request(app)
      .delete('/wallets/does-not-exist')
      .set('x-test-user', JSON.stringify(keyA));
    const foreign = await request(app)
      .delete('/wallets/wallet-b')
      .set('x-test-user', JSON.stringify(keyA));

    expect(missing.status).toBe(404);
    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
  });

  test('admin bypasses ownership', async () => {
    const res = await request(buildApp())
      .delete('/wallets/wallet-b')
      .set('x-test-user', JSON.stringify(admin));

    expect(res.status).toBe(200);
  });
});
