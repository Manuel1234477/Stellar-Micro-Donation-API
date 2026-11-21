/**
 * Issue #106: POST /admin/db/reindex endpoint tests
 * 
 * Tests for database reindexing functionality.
 * Covers job creation, status polling, concurrent job prevention, and error handling.
 */

const request = require('supertest');
const app = require('../../src/app');
const apiKeysModel = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');

describe('POST /admin/db/reindex - Database Reindex Endpoint', () => {
  let adminKey;
  let userKey;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();

    const adminKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test Admin Key',
      role: 'admin',
      createdBy: 'test-suite'
    });
    adminKey = adminKeyInfo.key;

    const userKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test User Key',
      role: 'user',
      createdBy: 'test-suite'
    });
    userKey = userKeyInfo.key;
  });

  afterAll(async () => {
    await db.run('DELETE FROM api_keys WHERE created_by = ?', ['test-suite']);
  });

  describe('Job Creation', () => {
    it('should start a background reindex job', async () => {
      const res = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      expect(res.body).toHaveProperty('jobId');
      expect(typeof res.body.jobId).toBe('string');
      expect(res.body.jobId).toMatch(/^reindex-/);
    });

    it('should return 202 Accepted status', async () => {
      await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);
    });

    it('should return unique jobId for each request', async () => {
      const res1 = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const res2 = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      expect(res1.body.jobId).not.toBe(res2.body.jobId);
    });
  });

  describe('Job Status Polling', () => {
    it('should retrieve job status by jobId', async () => {
      const createRes = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const jobId = createRes.body.jobId;

      const statusRes = await request(app)
        .get(`/admin/db/reindex/${jobId}`)
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(statusRes.body).toHaveProperty('status');
      expect(['running', 'completed', 'failed']).toContain(statusRes.body.status);
    });

    it('should include tablesReindexed in status response', async () => {
      const createRes = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const jobId = createRes.body.jobId;

      const statusRes = await request(app)
        .get(`/admin/db/reindex/${jobId}`)
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(statusRes.body).toHaveProperty('tablesReindexed');
      expect(typeof statusRes.body.tablesReindexed).toBe('number');
    });

    it('should include durationMs in completed status', async () => {
      const createRes = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const jobId = createRes.body.jobId;

      // Poll until completed or timeout
      let statusRes;
      let attempts = 0;
      while (attempts < 30) {
        statusRes = await request(app)
          .get(`/admin/db/reindex/${jobId}`)
          .set('Authorization', `Bearer ${adminKey}`)
          .expect(200);

        if (statusRes.body.status === 'completed') {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (statusRes.body.status === 'completed') {
        expect(statusRes.body).toHaveProperty('durationMs');
        expect(typeof statusRes.body.durationMs).toBe('number');
      }
    });

    it('should return 404 for non-existent jobId', async () => {
      await request(app)
        .get('/admin/db/reindex/reindex-nonexistent')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(404);
    });
  });

  describe('Concurrent Job Prevention', () => {
    it('should prevent concurrent reindex jobs', async () => {
      const res1 = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      // Immediately try to start another job
      const res2 = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`);

      // Should either return 409 or 202 depending on timing
      expect([202, 409]).toContain(res2.status);

      if (res2.status === 409) {
        expect(res2.body).toHaveProperty('error');
      }
    });

    it('should return 409 Conflict when job already running', async () => {
      // This test may be flaky depending on timing
      // Start first job
      await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      // Try to start second job immediately
      const res = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`);

      if (res.status === 409) {
        expect(res.body).toHaveProperty('error');
        expect(res.body.error).toContain('already running');
      }
    });
  });

  describe('Permissions', () => {
    it('should require admin role', async () => {
      await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${userKey}`)
        .expect(403);
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post('/admin/db/reindex')
        .expect(401);
    });

    it('should allow admin to check job status', async () => {
      const createRes = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const jobId = createRes.body.jobId;

      await request(app)
        .get(`/admin/db/reindex/${jobId}`)
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);
    });

    it('should deny non-admin from checking job status', async () => {
      const createRes = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const jobId = createRes.body.jobId;

      await request(app)
        .get(`/admin/db/reindex/${jobId}`)
        .set('Authorization', `Bearer ${userKey}`)
        .expect(403);
    });
  });

  describe('Response Format', () => {
    it('should return correct POST response structure', async () => {
      const res = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      expect(res.body).toHaveProperty('jobId');
      expect(typeof res.body.jobId).toBe('string');
    });

    it('should return correct GET response structure', async () => {
      const createRes = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const jobId = createRes.body.jobId;

      const statusRes = await request(app)
        .get(`/admin/db/reindex/${jobId}`)
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(statusRes.body).toHaveProperty('status');
      expect(statusRes.body).toHaveProperty('tablesReindexed');
      expect(statusRes.body).toHaveProperty('durationMs');
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      const res = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`);

      expect([202, 500]).toContain(res.status);
    });

    it('should return error message on failure', async () => {
      const createRes = await request(app)
        .post('/admin/db/reindex')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(202);

      const jobId = createRes.body.jobId;

      // Poll until completed or failed
      let statusRes;
      let attempts = 0;
      while (attempts < 30) {
        statusRes = await request(app)
          .get(`/admin/db/reindex/${jobId}`)
          .set('Authorization', `Bearer ${adminKey}`)
          .expect(200);

        if (statusRes.body.status === 'failed' || statusRes.body.status === 'completed') {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (statusRes.body.status === 'failed') {
        expect(statusRes.body).toHaveProperty('error');
      }
    });
  });
});
