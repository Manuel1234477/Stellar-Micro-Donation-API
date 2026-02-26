/**
 * Negative Authorization Tests
 * Tests for unauthorized access attempts and insufficient permissions
 * Issue #211
 */

const request = require('supertest');
const express = require('express');
const requireApiKey = require('../../../src/middleware/apiKey');
const { checkPermission, checkAnyPermission, checkAllPermissions, requireAdmin, attachUserRole } = require('../../../src/middleware/rbac');
const { PERMISSIONS, ROLES } = require('../../../src/utils/permissions');
const { validateApiKey } = require('../../../src/models/apiKeys');
const { errorHandler } = require('../../../src/middleware/errorHandler');

jest.mock('../../../src/models/apiKeys');

describe('Negative Authorization Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    validateApiKey.mockReset();
  });

  // Helper to add error handler after routes
  const addErrorHandler = () => {
    app.use(errorHandler);
  };

  describe('Invalid API Keys', () => {
    test('should reject request with no API key header', async () => {
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toContain('API key required');
    });

    test('should reject request with empty API key', async () => {
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', '');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should reject request with invalid API key', async () => {
      validateApiKey.mockResolvedValue(null);
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', 'invalid-key-12345');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
      expect(response.body.error.message).toContain('Invalid or expired');
    });

    test('should reject request with malformed API key', async () => {
      validateApiKey.mockResolvedValue(null);
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', '!!!invalid!!!');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should reject request with expired API key', async () => {
      validateApiKey.mockResolvedValue(null);
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', 'expired-key-abc');

      expect(response.status).toBe(401);
      expect(response.body.error.message).toContain('Invalid or expired');
    });

    test('should reject request with revoked API key', async () => {
      validateApiKey.mockResolvedValue(null);
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', 'revoked-key-xyz');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Insufficient Permissions', () => {
    test('should block guest from creating donations', async () => {
      app.use(attachUserRole());
      app.use(checkPermission(PERMISSIONS.DONATIONS_CREATE));
      app.post('/donations', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 1, role: ROLES.GUEST });

      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'guest-key');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    test('should block user from deleting wallets', async () => {
      app.use(attachUserRole());
      app.use(checkPermission(PERMISSIONS.WALLETS_DELETE));
      app.delete('/wallets/:id', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 2, role: ROLES.USER });

      const response = await request(app)
        .delete('/wallets/123')
        .set('x-api-key', 'user-key');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
      expect(response.body.error.message).toContain('Insufficient permissions');
    });

    test('should block guest from updating wallets', async () => {
      app.use(attachUserRole());
      app.use(checkPermission(PERMISSIONS.WALLETS_UPDATE));
      app.patch('/wallets/:id', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 3, role: ROLES.GUEST });

      const response = await request(app)
        .patch('/wallets/123')
        .set('x-api-key', 'guest-key');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    test('should block user from accessing admin-only endpoints', async () => {
      app.use(attachUserRole());
      app.use(requireAdmin());
      app.get('/admin/keys', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 4, role: ROLES.USER });

      const response = await request(app)
        .get('/admin/keys')
        .set('x-api-key', 'user-key');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
      expect(response.body.error.message).toContain('Admin access required');
    });

    test('should block guest from accessing admin endpoints', async () => {
      app.use(attachUserRole());
      app.use(requireAdmin());
      app.post('/admin/config', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 5, role: ROLES.GUEST });

      const response = await request(app)
        .post('/admin/config')
        .set('x-api-key', 'guest-key');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Unauthenticated Access', () => {
    test('should block unauthenticated access to protected endpoint', async () => {
      app.use(checkPermission(PERMISSIONS.DONATIONS_CREATE));
      app.post('/donations', (req, res) => res.json({ success: true }));
      addErrorHandler();

      const response = await request(app).post('/donations');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should block access when user object is missing', async () => {
      app.use((req, res, next) => {
        req.user = null;
        next();
      });
      app.use(checkPermission(PERMISSIONS.WALLETS_READ));
      app.get('/wallets', (req, res) => res.json({ success: true }));
      addErrorHandler();

      const response = await request(app).get('/wallets');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should block access to admin endpoints without authentication', async () => {
      app.use(requireAdmin());
      app.get('/admin/users', (req, res) => res.json({ success: true }));
      addErrorHandler();

      const response = await request(app).get('/admin/users');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Multiple Permission Checks', () => {
    test('should block when user lacks all required permissions', async () => {
      app.use(attachUserRole());
      app.use(checkAllPermissions([
        PERMISSIONS.DONATIONS_CREATE,
        PERMISSIONS.WALLETS_DELETE
      ]));
      app.post('/test', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 6, role: ROLES.USER });

      const response = await request(app)
        .post('/test')
        .set('x-api-key', 'user-key');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });

    test('should block when user lacks any of required permissions', async () => {
      app.use(attachUserRole());
      app.use(checkAnyPermission([
        PERMISSIONS.WALLETS_DELETE,
        PERMISSIONS.DONATIONS_DELETE
      ]));
      app.delete('/test', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 7, role: ROLES.USER });

      const response = await request(app)
        .delete('/test')
        .set('x-api-key', 'user-key');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('Error Response Standardization', () => {
    test('should return standardized error for missing API key', async () => {
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test');

      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(typeof response.body.error.message).toBe('string');
    });

    test('should return standardized error for invalid API key', async () => {
      validateApiKey.mockResolvedValue(null);
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', 'bad-key');

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: expect.any(String),
          message: expect.any(String)
        }
      });
    });

    test('should return standardized error for insufficient permissions', async () => {
      app.use(attachUserRole());
      app.use(checkPermission(PERMISSIONS.WALLETS_DELETE));
      app.delete('/test', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 8, role: ROLES.USER });

      const response = await request(app)
        .delete('/test')
        .set('x-api-key', 'user-key');

      expect(response.body).toMatchObject({
        success: false,
        error: {
          code: 'ACCESS_DENIED',
          message: expect.stringContaining('Insufficient permissions')
        }
      });
    });

    test('should return clear error message for admin-only access', async () => {
      app.use(attachUserRole());
      app.use(requireAdmin());
      app.get('/test', (req, res) => res.json({ success: true }));
      addErrorHandler();

      validateApiKey.mockResolvedValue({ id: 9, role: ROLES.USER });

      const response = await request(app)
        .get('/test')
        .set('x-api-key', 'user-key');

      expect(response.body.error.message).toContain('Admin');
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('Edge Cases', () => {
    test('should handle API key validation error gracefully', async () => {
      validateApiKey.mockRejectedValue(new Error('Database error'));
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', 'some-key');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
    });

    test('should reject API key with special characters', async () => {
      validateApiKey.mockResolvedValue(null);
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('x-api-key', '<script>alert("xss")</script>');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should reject extremely long API key', async () => {
      validateApiKey.mockResolvedValue(null);
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const longKey = 'a'.repeat(10000);
      const response = await request(app)
        .get('/test')
        .set('x-api-key', longKey);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should handle missing role in user object', async () => {
      app.use((req, res, next) => {
        req.user = { id: 1 }; // No role
        next();
      });
      app.use(checkPermission(PERMISSIONS.DONATIONS_CREATE));
      app.post('/test', (req, res) => res.json({ success: true }));
      addErrorHandler();

      const response = await request(app).post('/test');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ACCESS_DENIED');
    });
  });

  describe('Cross-Origin Authorization', () => {
    test('should reject API key passed in query string', async () => {
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app).get('/test?api_key=test-key');

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should reject API key passed in request body', async () => {
      app.use(requireApiKey);
      app.post('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .post('/test')
        .send({ api_key: 'test-key' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    test('should only accept API key in x-api-key header', async () => {
      validateApiKey.mockResolvedValue({ id: 10, role: ROLES.USER });
      app.use(requireApiKey);
      app.get('/test', (req, res) => res.json({ success: true }));

      const response = await request(app)
        .get('/test')
        .set('authorization', 'Bearer test-key');

      expect(response.status).toBe(401);
    });
  });
});
