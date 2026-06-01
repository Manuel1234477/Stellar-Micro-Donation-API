/**
 * Tests for Issue #123: Async Job Tracking for Donation Export
 * 
 * Verifies:
 * - POST /donations/export creates job and returns 202
 * - GET /donations/export/:jobId returns job status
 * - Job progresses through queued → processing → completed
 * - Completed jobs provide downloadUrl with expiry
 * - GET /donations/export/:jobId/download serves file with valid token
 * - Expired URLs are regenerated
 * - Cleanup removes jobs older than 24 hours
 */

'use strict';

const request = require('supertest');
const Database = require('../../src/utils/database');
const DonationExportService = require('../../src/services/DonationExportService');
const fs = require('fs').promises;
const path = require('path');

describe('Issue #123: Async Donation Export', () => {
  let app;
  let adminApiKey;
  let testDonations = [];

  beforeAll(async () => {
    await Database.initialize();
    await DonationExportService.initialize();

    // Create test app
    app = require('../../src/routes/app');

    // Create admin API key
    await Database.run(`
      INSERT INTO api_keys (id, key_hash, name, role, tier, created_at)
      VALUES ('admin-key', 'hash', 'Admin Key', 'admin', 'enterprise', datetime('now'))
    `);
    adminApiKey = 'admin-key';

    // Create test users
    await Database.run(`
      INSERT INTO users (id, publicKey, createdAt)
      VALUES 
        ('sender1', 'SENDER_PUBLIC_KEY_1', datetime('now')),
        ('recipient1', 'RECIPIENT_PUBLIC_KEY_1', datetime('now'))
    `);

    // Create test donations
    for (let i = 1; i <= 5; i++) {
      const result = await Database.run(`
        INSERT INTO transactions (senderId, receiverId, amount, memo, status, timestamp, stellar_tx_id)
        VALUES ('sender1', 'recipient1', ?, ?, 'completed', datetime('now'), ?)
      `, [i * 10, `Test donation ${i}`, `tx_hash_${i}`]);
      testDonations.push(result.id);
    }
  });

  afterAll(async () => {
    // Cleanup test data
    await Database.run('DELETE FROM donation_exports');
    await Database.run('DELETE FROM transactions WHERE id IN (' + testDonations.join(',') + ')');
    await Database.run('DELETE FROM users WHERE id IN (?, ?)', ['sender1', 'recipient1']);
    await Database.run('DELETE FROM api_keys WHERE id = ?', [adminApiKey]);

    // Cleanup export files
    const exportDir = path.join(__dirname, '../../data/exports');
    try {
      const files = await fs.readdir(exportDir);
      for (const file of files) {
        if (file.startsWith('export-')) {
          await fs.unlink(path.join(exportDir, file)).catch(() => {});
        }
      }
    } catch (err) {
      // Directory might not exist
    }
  });

  describe('POST /donations/export', () => {
    it('should queue export job and return 202 with jobId', async () => {
      const response = await request(app)
        .post('/donations/export')
        .set('X-API-Key', adminApiKey)
        .send({
          format: 'csv',
        })
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('jobId');
      expect(response.body.data.jobId).toMatch(/^export-\d+-[a-f0-9]{8}$/);
      expect(response.body.data.status).toBe('queued');
    });

    it('should accept filter parameters', async () => {
      const response = await request(app)
        .post('/donations/export')
        .set('X-API-Key', adminApiKey)
        .send({
          format: 'json',
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
          status: 'completed',
        })
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('jobId');
    });

    it('should reject invalid format', async () => {
      const response = await request(app)
        .post('/donations/export')
        .set('X-API-Key', adminApiKey)
        .send({
          format: 'xml',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should reject invalid date range', async () => {
      const response = await request(app)
        .post('/donations/export')
        .set('X-API-Key', adminApiKey)
        .send({
          format: 'csv',
          startDate: '2024-12-31T00:00:00Z',
          endDate: '2024-01-01T00:00:00Z',
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should require admin role', async () => {
      // Create non-admin API key
      await Database.run(`
        INSERT INTO api_keys (id, key_hash, name, role, tier, created_at)
        VALUES ('user-key', 'hash', 'User Key', 'user', 'free', datetime('now'))
      `);

      const response = await request(app)
        .post('/donations/export')
        .set('X-API-Key', 'user-key')
        .send({
          format: 'csv',
        })
        .expect(403);

      expect(response.body.success).toBe(false);

      await Database.run('DELETE FROM api_keys WHERE id = ?', ['user-key']);
    });
  });

  describe('GET /donations/export/:jobId', () => {
    let jobId;

    beforeEach(async () => {
      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'csv',
      });
      jobId = result.jobId;
    });

    it('should return job status', async () => {
      const response = await request(app)
        .get(`/donations/export/${jobId}`)
        .set('X-API-Key', adminApiKey)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('jobId', jobId);
      expect(response.body.data).toHaveProperty('status');
      expect(['queued', 'processing', 'completed']).toContain(response.body.data.status);
      expect(response.body.data).toHaveProperty('progress');
      expect(response.body.data.progress).toHaveProperty('processed');
      expect(response.body.data.progress).toHaveProperty('total');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await request(app)
        .get('/donations/export/export-9999999999-ffffffff')
        .set('X-API-Key', adminApiKey)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should include downloadUrl when job is completed', async () => {
      // Wait for job to complete (with timeout)
      let attempts = 0;
      let status;
      while (attempts < 20) {
        const response = await request(app)
          .get(`/donations/export/${jobId}`)
          .set('X-API-Key', adminApiKey);

        status = response.body.data;
        if (status.status === 'completed') {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      expect(status.status).toBe('completed');
      expect(status.downloadUrl).toBeTruthy();
      expect(status.downloadUrl).toMatch(/\/donations\/export\/.+\/download\?token=.+&expires=.+/);
      expect(status.urlExpiresAt).toBeTruthy();
      expect(status.progress.processed).toBeGreaterThan(0);
    });
  });

  describe('GET /donations/export/:jobId/download', () => {
    let jobId;
    let downloadUrl;

    beforeEach(async () => {
      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'csv',
      });
      jobId = result.jobId;

      // Wait for job to complete
      let attempts = 0;
      while (attempts < 20) {
        const status = await DonationExportService.getJobStatus(jobId);
        if (status.status === 'completed') {
          downloadUrl = status.downloadUrl;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }
    });

    it('should download completed export with valid token', async () => {
      expect(downloadUrl).toBeTruthy();

      // Extract path and query from downloadUrl
      const url = new URL(downloadUrl, 'http://localhost');
      const response = await request(app)
        .get(url.pathname + url.search)
        .set('X-API-Key', adminApiKey)
        .expect(200);

      expect(response.headers['content-type']).toBe('text/csv');
      expect(response.headers['content-disposition']).toMatch(/attachment; filename="donations-.+\.csv"/);
      expect(response.text).toContain('id,amount,senderPublicKey');
    });

    it('should reject download with invalid token', async () => {
      const response = await request(app)
        .get(`/donations/export/${jobId}/download?token=invalid&expires=${new Date(Date.now() + 3600000).toISOString()}`)
        .set('X-API-Key', adminApiKey)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
    });

    it('should reject download with expired token', async () => {
      const expiredDate = new Date(Date.now() - 1000).toISOString();
      const response = await request(app)
        .get(`/donations/export/${jobId}/download?token=anything&expires=${expiredDate}`)
        .set('X-API-Key', adminApiKey)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_REQUEST');
      expect(response.body.error.message).toContain('expired');
    });

    it('should reject download without token or expires params', async () => {
      const response = await request(app)
        .get(`/donations/export/${jobId}/download`)
        .set('X-API-Key', adminApiKey)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_PARAMS');
    });
  });

  describe('Export formats', () => {
    it('should generate CSV export correctly', async () => {
      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'csv',
      });

      // Wait for completion
      let attempts = 0;
      let status;
      while (attempts < 20) {
        status = await DonationExportService.getJobStatus(result.jobId);
        if (status.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      expect(status.status).toBe('completed');

      // Download and verify CSV
      const url = new URL(status.downloadUrl, 'http://localhost');
      const response = await request(app)
        .get(url.pathname + url.search)
        .set('X-API-Key', adminApiKey);

      const lines = response.text.split('\n');
      expect(lines[0]).toBe('id,amount,senderPublicKey,recipientPublicKey,memo,status,timestamp,transactionHash');
      expect(lines.length).toBeGreaterThan(1);
    });

    it('should generate JSON export correctly', async () => {
      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'json',
      });

      // Wait for completion
      let attempts = 0;
      let status;
      while (attempts < 20) {
        status = await DonationExportService.getJobStatus(result.jobId);
        if (status.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      expect(status.status).toBe('completed');

      // Download and verify JSON
      const url = new URL(status.downloadUrl, 'http://localhost');
      const response = await request(app)
        .get(url.pathname + url.search)
        .set('X-API-Key', adminApiKey);

      const data = JSON.parse(response.text);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('amount');
      expect(data[0]).toHaveProperty('senderPublicKey');
    });
  });

  describe('Export filters', () => {
    it('should filter by status', async () => {
      // Create a pending donation
      await Database.run(`
        INSERT INTO transactions (senderId, receiverId, amount, memo, status, timestamp, stellar_tx_id)
        VALUES ('sender1', 'recipient1', 100, 'Pending donation', 'pending', datetime('now'), 'tx_pending')
      `);

      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'json',
        status: 'pending',
      });

      // Wait for completion
      let attempts = 0;
      let status;
      while (attempts < 20) {
        status = await DonationExportService.getJobStatus(result.jobId);
        if (status.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      // Download and verify
      const url = new URL(status.downloadUrl, 'http://localhost');
      const response = await request(app)
        .get(url.pathname + url.search)
        .set('X-API-Key', adminApiKey);

      const data = JSON.parse(response.text);
      expect(data.every(d => d.status === 'pending')).toBe(true);

      // Cleanup
      await Database.run('DELETE FROM transactions WHERE stellar_tx_id = ?', ['tx_pending']);
    });

    it('should filter by sender public key', async () => {
      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'json',
        senderPublicKey: 'SENDER_PUBLIC_KEY_1',
      });

      // Wait for completion
      let attempts = 0;
      let status;
      while (attempts < 20) {
        status = await DonationExportService.getJobStatus(result.jobId);
        if (status.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      // Download and verify
      const url = new URL(status.downloadUrl, 'http://localhost');
      const response = await request(app)
        .get(url.pathname + url.search)
        .set('X-API-Key', adminApiKey);

      const data = JSON.parse(response.text);
      expect(data.every(d => d.senderPublicKey === 'SENDER_PUBLIC_KEY_1')).toBe(true);
    });
  });

  describe('Cleanup', () => {
    it('should delete exports older than 24 hours', async () => {
      // Create an old export job
      const oldJobId = 'export-1234567890-abcd1234';
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago

      await Database.run(`
        INSERT INTO donation_exports (
          export_id, api_key_id, format, status, created_at
        ) VALUES (?, ?, 'csv', 'completed', ?)
      `, [oldJobId, adminApiKey, oldDate]);

      // Run cleanup
      const deletedCount = await DonationExportService.deleteExpiredExports();

      expect(deletedCount).toBeGreaterThan(0);

      // Verify job is deleted
      const job = await Database.get(
        'SELECT * FROM donation_exports WHERE export_id = ?',
        [oldJobId]
      );
      expect(job).toBeUndefined();
    });

    it('should not delete recent exports', async () => {
      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'csv',
      });

      // Run cleanup
      await DonationExportService.deleteExpiredExports();

      // Verify job still exists
      const job = await Database.get(
        'SELECT * FROM donation_exports WHERE export_id = ?',
        [result.jobId]
      );
      expect(job).toBeDefined();
    });
  });

  describe('URL expiry and regeneration', () => {
    it('should regenerate expired download URL', async () => {
      const result = await DonationExportService.queueExportJob(adminApiKey, {
        format: 'csv',
      });

      // Wait for completion
      let attempts = 0;
      while (attempts < 20) {
        const status = await DonationExportService.getJobStatus(result.jobId);
        if (status.status === 'completed') break;
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      // Manually expire the URL
      const pastDate = new Date(Date.now() - 1000).toISOString();
      await Database.run(
        'UPDATE donation_exports SET signed_url_expires_at = ? WHERE export_id = ?',
        [pastDate, result.jobId]
      );

      // Get status again - should regenerate URL
      const status = await DonationExportService.getJobStatus(result.jobId);
      expect(status.downloadUrl).toBeTruthy();
      expect(new Date(status.urlExpiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Error handling', () => {
    it('should handle job processing errors gracefully', async () => {
      // Create a job with invalid filters that will cause an error
      const jobId = DonationExportService.generateExportId();
      await Database.run(`
        INSERT INTO donation_exports (
          export_id, api_key_id, format, status, created_at
        ) VALUES (?, ?, 'csv', 'queued', ?)
      `, [jobId, 'non-existent-key', new Date().toISOString()]);

      // Manually trigger processing
      await DonationExportService.processExportJob(jobId);

      // Check status
      const job = await Database.get(
        'SELECT * FROM donation_exports WHERE export_id = ?',
        [jobId]
      );

      expect(job.status).toBe('failed');
      expect(job.error_message).toBeTruthy();
    });
  });
});
