/**
 * API Quotas Test Suite
 * Tests monthly quota enforcement, reset logic, and webhook events
 */

const request = require('supertest');
const { createApiKey, resetExpiredQuotas, incrementQuota, getNextMonthFirstDay } = require('../src/models/apiKeys');
const db = require('../src/utils/database');
const WebhookService = require('../src/services/WebhookService');

// Mock WebhookService
jest.mock('../src/services/WebhookService', () => ({
  deliver: jest.fn().mockResolvedValue({}),
  initTable: jest.fn().mockResolvedValue({}),
}));

let app;
let testApiKey;
let testApiKeyWithQuota;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_STELLAR = 'true';
  process.env.API_KEYS = 'test-key-123';
  
  // Import app after env is set
  app = require('../src/routes/app');
  
  // Create test API keys
  testApiKey = await createApiKey({
    name: 'Test Key No Quota',
    role: 'user',
    createdBy: 'test',
  });

  testApiKeyWithQuota = await createApiKey({
    name: 'Test Key With Quota',
    role: 'user',
    createdBy: 'test',
    monthlyQuota: 10,
  });
});

afterAll(async () => {
  await db.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('API Quota Enforcement', () => {
  test('requests without quota proceed normally', async () => {
    const response = await request(app)
      .get('/health')
      .set('x-api-key', testApiKey.key);

    expect(response.status).toBe(200);
    expect(response.headers['x-quota-limit']).toBeUndefined();
    expect(response.headers['x-quota-remaining']).toBeUndefined();
  });

  test('requests with quota show remaining quota in headers', async () => {
    const response = await request(app)
      .get('/health')
      .set('x-api-key', testApiKeyWithQuota.key);

    expect(response.status).toBe(200);
    expect(response.headers['x-quota-limit']).toBe('10');
    expect(response.headers['x-quota-remaining']).toBeDefined();
    expect(parseInt(response.headers['x-quota-remaining'])).toBeLessThanOrEqual(10);
  });

  test('requests exceeding quota return 429', async () => {
    // Create a key with very low quota
    const lowQuotaKey = await createApiKey({
      name: 'Low Quota Key',
      role: 'user',
      createdBy: 'test',
      monthlyQuota: 2,
    });

    // Use up the quota
    await incrementQuota(lowQuotaKey.id);
    await incrementQuota(lowQuotaKey.id);

    const response = await request(app)
      .get('/health')
      .set('x-api-key', lowQuotaKey.key);

    expect(response.status).toBe(429);
    expect(response.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(response.body.error.message).toContain('quota exceeded');
    expect(response.body.error.quotaResetAt).toBeDefined();
  });

  test('quota exceeded fires webhook event', async () => {
    const quotaKey = await createApiKey({
      name: 'Quota Webhook Test',
      role: 'user',
      createdBy: 'test',
      monthlyQuota: 1,
    });

    // Exhaust quota
    await incrementQuota(quotaKey.id);

    await request(app)
      .get('/health')
      .set('x-api-key', quotaKey.key);

    expect(WebhookService.deliver).toHaveBeenCalledWith(
      'quota.exceeded',
      expect.objectContaining({
        keyId: quotaKey.id,
        keyName: 'Quota Webhook Test',
        quotaUsed: 1,
        monthlyQuota: 1,
      })
    );
  });

  test('X-Quota-Remaining header shows accurate count', async () => {
    const accuracyKey = await createApiKey({
      name: 'Accuracy Test Key',
      role: 'user',
      createdBy: 'test',
      monthlyQuota: 5,
    });

    // First request
    const res1 = await request(app)
      .get('/health')
      .set('x-api-key', accuracyKey.key);
    
    expect(res1.status).toBe(200);
    const remaining1 = parseInt(res1.headers['x-quota-remaining']);
    expect(remaining1).toBe(5);

    // Increment quota manually to simulate usage
    await incrementQuota(accuracyKey.id);

    // Second request
    const res2 = await request(app)
      .get('/health')
      .set('x-api-key', accuracyKey.key);
    
    expect(res2.status).toBe(200);
    const remaining2 = parseInt(res2.headers['x-quota-remaining']);
    expect(remaining2).toBe(4);
  });
});

describe('Monthly Quota Reset', () => {
  test('quotas reset on first of month', async () => {
    const resetKey = await createApiKey({
      name: 'Reset Test Key',
      role: 'user',
      createdBy: 'test',
      monthlyQuota: 100,
    });

    // Use some quota
    await incrementQuota(resetKey.id);
    await incrementQuota(resetKey.id);
    await incrementQuota(resetKey.id);

    // Manually set reset date to past
    await db.run(
      `UPDATE api_keys SET quota_reset_at = ? WHERE id = ?`,
      [Date.now() - 1000, resetKey.id]
    );

    // Run reset job
    const resetCount = await resetExpiredQuotas();
    expect(resetCount).toBeGreaterThan(0);

    // Verify quota was reset
    const row = await db.get(`SELECT quota_used, quota_reset_at FROM api_keys WHERE id = ?`, [resetKey.id]);
    expect(row.quota_used).toBe(0);
    expect(row.quota_reset_at).toBeGreaterThan(Date.now());
  });

  test('quota reset fires webhook event', async () => {
    const { checkAndResetQuotas } = require('../src/jobs/quotaResetJob');
    
    // Create key with expired reset date
    const webhookKey = await createApiKey({
      name: 'Webhook Reset Test',
      role: 'user',
      createdBy: 'test',
      monthlyQuota: 50,
    });

    await incrementQuota(webhookKey.id);
    await db.run(
      `UPDATE api_keys SET quota_reset_at = ? WHERE id = ?`,
      [Date.now() - 1000, webhookKey.id]
    );

    jest.clearAllMocks();
    await checkAndResetQuotas();

    expect(WebhookService.deliver).toHaveBeenCalledWith(
      'quota.reset',
      expect.objectContaining({
        keysReset: expect.any(Number),
        resetAt: expect.any(String),
      })
    );
  });

  test('getNextMonthFirstDay returns correct timestamp', () => {
    const nextMonth = getNextMonthFirstDay();
    const date = new Date(nextMonth);
    
    expect(date.getUTCDate()).toBe(1);
    expect(date.getUTCHours()).toBe(0);
    expect(date.getUTCMinutes()).toBe(0);
    expect(date.getUTCSeconds()).toBe(0);
    expect(nextMonth).toBeGreaterThan(Date.now());
  });

  test('quota reset handles timezone edge cases', async () => {
    // Test that reset happens at UTC midnight, not local time
    const key = await createApiKey({
      name: 'Timezone Test Key',
      role: 'user',
      createdBy: 'test',
      monthlyQuota: 100,
    });

    const row = await db.get(`SELECT quota_reset_at FROM api_keys WHERE id = ?`, [key.id]);
    const resetDate = new Date(row.quota_reset_at);
    
    // Verify it's set to UTC midnight
    expect(resetDate.getUTCHours()).toBe(0);
    expect(resetDate.getUTCMinutes()).toBe(0);
    expect(resetDate.getUTCDate()).toBe(1);
  });
});

describe('Quota Header Accuracy', () => {
  test('headers reflect current quota state', async () => {
    const headerKey = await createApiKey({
      name: 'Header Test Key',
      role: 'user',
      createdBy: 'test',
      monthlyQuota: 3,
    });

    // Request 1
    const res1 = await request(app)
      .get('/health')
      .set('x-api-key', headerKey.key);
    expect(res1.headers['x-quota-remaining']).toBe('3');

    // Increment manually
    await incrementQuota(headerKey.id);

    // Request 2
    const res2 = await request(app)
      .get('/health')
      .set('x-api-key', headerKey.key);
    expect(res2.headers['x-quota-remaining']).toBe('2');
  });

  test('quota reset header shows next reset date', async () => {
    const response = await request(app)
      .get('/health')
      .set('x-api-key', testApiKeyWithQuota.key);

    expect(response.headers['x-quota-reset']).toBeDefined();
    const resetDate = new Date(response.headers['x-quota-reset']);
    expect(resetDate.getTime()).toBeGreaterThan(Date.now());
  });
});
