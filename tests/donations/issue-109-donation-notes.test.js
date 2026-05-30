/**
 * Test: POST /donations/:id/notes endpoint for private notes
 * Issue #109
 */

const request = require('supertest');
const { createApiKey } = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');

let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_STELLAR = 'true';
  app = require('../../src/routes/app');
});

afterAll(async () => {
  await db.close();
});

describe('POST /donations/:id/notes', () => {
  test('requires donations:write permission', async () => {
    const guestKey = await createApiKey({
      name: 'Test Guest Key',
      role: 'guest',
    });

    const res = await request(app)
      .post('/donations/1/notes')
      .set('Authorization', `Bearer ${guestKey.key}`)
      .send({ note: 'Test note' });

    expect(res.status).toBe(403);
  });

  test('returns 404 for non-existent donation', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key',
      role: 'user',
    });

    const res = await request(app)
      .post('/donations/99999/notes')
      .set('Authorization', `Bearer ${userKey.key}`)
      .send({ note: 'Test note' });

    expect(res.status).toBe(404);
  });

  test('enforces 500 character limit', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key 2',
      role: 'user',
    });

    const longNote = 'a'.repeat(501);

    const res = await request(app)
      .post('/donations/1/notes')
      .set('Authorization', `Bearer ${userKey.key}`)
      .send({ note: longNote });

    expect(res.status).toBe(400);
  });
});

describe('GET /donations/:id/notes', () => {
  test('requires donations:read permission', async () => {
    const guestKey = await createApiKey({
      name: 'Test Guest Key 2',
      role: 'guest',
    });

    const res = await request(app)
      .get('/donations/1/notes')
      .set('Authorization', `Bearer ${guestKey.key}`);

    expect(res.status).toBe(403);
  });

  test('returns 404 for non-existent donation', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key 3',
      role: 'user',
    });

    const res = await request(app)
      .get('/donations/99999/notes')
      .set('Authorization', `Bearer ${userKey.key}`);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /donations/:id/notes/:noteId', () => {
  test('returns 404 for non-existent note', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key 4',
      role: 'user',
    });

    const res = await request(app)
      .delete('/donations/1/notes/99999')
      .set('Authorization', `Bearer ${userKey.key}`);

    expect(res.status).toBe(404);
  });
});
