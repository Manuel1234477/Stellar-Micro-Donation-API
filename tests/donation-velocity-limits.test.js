'use strict';

/**
 * Tests: Donation Velocity Limits
 * Covers: limit enforcement, window reset, concurrent requests, admin CRUD
 */

const DonationVelocityService = require('../src/services/DonationVelocityService');
const Database = require('../src/utils/database');

// ── helpers ──────────────────────────────────────────────────────────────────

async function seedRecipient(id = 1) {
  await Database.run(
    `INSERT OR IGNORE INTO users (id, publicKey, tenant_id) VALUES (?, ?, 'default')`,
    [id, `GRECIPIENT${String(id).padStart(46, '0')}`]
  );
}

async function seedDonor(id = 2) {
  await Database.run(
    `INSERT OR IGNORE INTO users (id, publicKey, tenant_id) VALUES (?, ?, 'default')`,
    [id, `GDONOR${String(id).padStart(50, '0')}`]
  );
}

async function clearVelocity() {
  await Database.run('DELETE FROM donation_velocity');
  await Database.run('DELETE FROM recipient_velocity_limits');
}

// ── setup / teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await Database.initialize();
  // Ensure migration tables exist
  await Database.run(`
    CREATE TABLE IF NOT EXISTS donation_velocity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donorId INTEGER NOT NULL,
      recipientId INTEGER NOT NULL,
      windowStart DATETIME NOT NULL,
      totalAmount REAL NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (donorId) REFERENCES users(id),
      FOREIGN KEY (recipientId) REFERENCES users(id)
    )
  `);
  await Database.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_velocity_donor_recipient_window
    ON donation_velocity(donorId, recipientId, windowStart)
  `);
  await Database.run(`
    CREATE TABLE IF NOT EXISTS recipient_velocity_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipientId INTEGER NOT NULL UNIQUE,
      maxAmount REAL,
      maxCount INTEGER,
      windowType TEXT NOT NULL DEFAULT 'daily',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recipientId) REFERENCES users(id)
    )
  `);
  await seedRecipient(1);
  await seedDonor(2);
});

beforeEach(async () => {
  await clearVelocity();
});

afterAll(async () => {
  await Database.close();
});

// ── getWindowStart ────────────────────────────────────────────────────────────

describe('getWindowStart', () => {
  test('daily window starts at midnight UTC', () => {
    const now = new Date('2025-06-15T14:30:00Z');
    const ws = DonationVelocityService.getWindowStart('daily', now);
    expect(ws).toBe('2025-06-15T00:00:00.000Z');
  });

  test('weekly window starts on Monday', () => {
    // 2025-06-18 is a Wednesday
    const now = new Date('2025-06-18T10:00:00Z');
    const ws = DonationVelocityService.getWindowStart('weekly', now);
    expect(ws).toBe('2025-06-16T00:00:00.000Z'); // Monday
  });

  test('monthly window starts on 1st of month', () => {
    const now = new Date('2025-06-18T10:00:00Z');
    const ws = DonationVelocityService.getWindowStart('monthly', now);
    expect(ws).toBe('2025-06-01T00:00:00.000Z');
  });
});

// ── setLimits / getLimits ─────────────────────────────────────────────────────

describe('setLimits / getLimits', () => {
  test('creates limits for a recipient', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 100, maxCount: 5, windowType: 'daily' });
    const limits = await DonationVelocityService.getLimits(1);
    expect(limits).not.toBeNull();
    expect(limits.maxAmount).toBe(100);
    expect(limits.maxCount).toBe(5);
    expect(limits.windowType).toBe('daily');
  });

  test('updates existing limits', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 100, windowType: 'daily' });
    await DonationVelocityService.setLimits(1, { maxAmount: 200, windowType: 'weekly' });
    const limits = await DonationVelocityService.getLimits(1);
    expect(limits.maxAmount).toBe(200);
    expect(limits.windowType).toBe('weekly');
  });

  test('returns null when no limits configured', async () => {
    const limits = await DonationVelocityService.getLimits(999);
    expect(limits).toBeNull();
  });

  test('rejects invalid windowType', async () => {
    await expect(
      DonationVelocityService.setLimits(1, { maxAmount: 100, windowType: 'hourly' })
    ).rejects.toThrow(/invalid windowType/i);
  });

  test('throws 404 for non-existent recipient', async () => {
    await expect(
      DonationVelocityService.setLimits(9999, { maxAmount: 100 })
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

// ── checkVelocityLimits ───────────────────────────────────────────────────────

describe('checkVelocityLimits', () => {
  test('passes when no limits configured', async () => {
    await expect(
      DonationVelocityService.checkVelocityLimits(2, 1, 50)
    ).resolves.toBeUndefined();
  });

  test('passes when under amount limit', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 100, windowType: 'daily' });
    await expect(
      DonationVelocityService.checkVelocityLimits(2, 1, 50)
    ).resolves.toBeUndefined();
  });

  test('throws 429 when amount limit exceeded', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 100, windowType: 'daily' });
    await DonationVelocityService.recordDonation(2, 1, 80);

    await expect(
      DonationVelocityService.checkVelocityLimits(2, 1, 30)
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  test('throws 429 when count limit exceeded', async () => {
    await DonationVelocityService.setLimits(1, { maxCount: 2, windowType: 'daily' });
    await DonationVelocityService.recordDonation(2, 1, 10);
    await DonationVelocityService.recordDonation(2, 1, 10);

    await expect(
      DonationVelocityService.checkVelocityLimits(2, 1, 10)
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  test('429 error includes resetAt in details', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 50, windowType: 'daily' });
    await DonationVelocityService.recordDonation(2, 1, 50);

    let caught;
    try {
      await DonationVelocityService.checkVelocityLimits(2, 1, 1);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.statusCode).toBe(429);
    expect(caught.resetAt).toBeDefined();
    expect(new Date(caught.resetAt).getTime()).toBeGreaterThan(Date.now());
  });

  test('limit is enforced before Stellar transaction (no side effects on failure)', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 10, windowType: 'daily' });
    await DonationVelocityService.recordDonation(2, 1, 10);

    // Verify check throws before any Stellar call would happen
    await expect(
      DonationVelocityService.checkVelocityLimits(2, 1, 5)
    ).rejects.toMatchObject({ statusCode: 429 });

    // Velocity counter should not have changed
    const usage = await DonationVelocityService.getVelocityUsage(2, 1);
    expect(usage.totalAmount).toBe(10);
    expect(usage.count).toBe(1);
  });
});

// ── recordDonation ────────────────────────────────────────────────────────────

describe('recordDonation', () => {
  test('creates a new velocity record', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 1000, windowType: 'daily' });
    await DonationVelocityService.recordDonation(2, 1, 25);
    const usage = await DonationVelocityService.getVelocityUsage(2, 1);
    expect(usage.totalAmount).toBe(25);
    expect(usage.count).toBe(1);
  });

  test('accumulates multiple donations', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 1000, windowType: 'daily' });
    await DonationVelocityService.recordDonation(2, 1, 10);
    await DonationVelocityService.recordDonation(2, 1, 20);
    await DonationVelocityService.recordDonation(2, 1, 30);
    const usage = await DonationVelocityService.getVelocityUsage(2, 1);
    expect(usage.totalAmount).toBe(60);
    expect(usage.count).toBe(3);
  });
});

// ── window reset ──────────────────────────────────────────────────────────────

describe('window reset', () => {
  test('velocity resets in a new window', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 50, windowType: 'daily' });

    // Simulate a donation in yesterday's window by inserting directly
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(0, 0, 0, 0);
    await Database.run(
      `INSERT INTO donation_velocity (donorId, recipientId, windowStart, totalAmount, count)
       VALUES (?, ?, ?, ?, ?)`,
      [2, 1, yesterday.toISOString(), 50, 5]
    );

    // Today's window should be clean — check should pass
    await expect(
      DonationVelocityService.checkVelocityLimits(2, 1, 50)
    ).resolves.toBeUndefined();
  });
});

// ── concurrent requests ───────────────────────────────────────────────────────

describe('concurrent requests', () => {
  test('handles concurrent donations without double-counting', async () => {
    await DonationVelocityService.setLimits(1, { maxAmount: 1000, windowType: 'daily' });

    // Fire 5 concurrent recordDonation calls
    await Promise.all([
      DonationVelocityService.recordDonation(2, 1, 10),
      DonationVelocityService.recordDonation(2, 1, 10),
      DonationVelocityService.recordDonation(2, 1, 10),
      DonationVelocityService.recordDonation(2, 1, 10),
      DonationVelocityService.recordDonation(2, 1, 10),
    ]);

    const usage = await DonationVelocityService.getVelocityUsage(2, 1);
    expect(usage.totalAmount).toBe(50);
    expect(usage.count).toBe(5);
  });
});
