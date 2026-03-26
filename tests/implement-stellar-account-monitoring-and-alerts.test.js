/**
 * Tests: Stellar Account Monitoring and Alerts
 * Covers AccountMonitorService CRUD, alert condition evaluation,
 * alert delivery (webhook + email), and the REST API endpoints.
 * No live Stellar network — uses MockStellarService throughout.
 */

const request = require('supertest');
const axios = require('axios');

const MockStellarService = require('../src/services/MockStellarService');
const AccountMonitorService = require('../src/services/AccountMonitorService');

// ─── Mock axios so webhook calls never hit the network ───────────────────────
jest.mock('axios');

// ─── App setup ───────────────────────────────────────────────────────────────
jest.mock('../src/config/stellar', () => ({
  getStellarService: () => new MockStellarService(),
  useMockStellar: true,
  network: 'testnet',
  port: undefined,
}));

const app = require('../src/routes/app');
const { setMonitorService } = require('../src/routes/monitors');

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function makeWallets(svc) {
  const donor = await svc.createWallet();
  const recipient = await svc.createWallet();
  await svc.fundTestnetWallet(donor.publicKey);
  await svc.fundTestnetWallet(recipient.publicKey);
  return { donor, recipient };
}

function validMonitorBody(accountId) {
  return {
    accountId,
    conditions: ['incoming_transaction'],
    alertConfig: { channel: 'webhook', webhookUrl: 'https://example.com/hook' },
  };
}

// =============================================================================
// AccountMonitorService — constructor
// =============================================================================
describe('AccountMonitorService constructor', () => {
  test('throws when stellarService is missing', () => {
    expect(() => new AccountMonitorService()).toThrow('stellarService is required');
  });

  test('initialises with empty monitors and alert log', () => {
    const svc = new AccountMonitorService(new MockStellarService());
    expect(svc.listMonitors()).toHaveLength(0);
    expect(svc.getAlertLog()).toHaveLength(0);
  });
});

// =============================================================================
// createMonitor — validation
// =============================================================================
describe('AccountMonitorService.createMonitor — validation', () => {
  let svc;
  beforeEach(() => { svc = new AccountMonitorService(new MockStellarService()); });

  test('throws for missing accountId', () => {
    expect(() => svc.createMonitor({ conditions: ['incoming_transaction'], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } }))
      .toThrow('accountId is required');
  });

  test('throws for empty accountId', () => {
    expect(() => svc.createMonitor({ accountId: '  ', conditions: ['incoming_transaction'], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } }))
      .toThrow('accountId is required');
  });

  test('throws for empty conditions array', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: [], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } }))
      .toThrow('conditions must be a non-empty array');
  });

  test('throws for invalid condition', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: ['unknown'], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } }))
      .toThrow('Invalid condition: unknown');
  });

  test('throws for low_balance without balanceThreshold', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: ['low_balance'], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } }))
      .toThrow('balanceThreshold must be a non-negative number');
  });

  test('throws for large_transaction without amountThreshold', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: ['large_transaction'], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } }))
      .toThrow('amountThreshold must be a positive number');
  });

  test('throws for missing alertConfig.channel', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: ['incoming_transaction'], alertConfig: {} }))
      .toThrow('alertConfig.channel is required');
  });

  test('throws for invalid channel', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: ['incoming_transaction'], alertConfig: { channel: 'sms' } }))
      .toThrow('Invalid channel: sms');
  });

  test('throws for webhook channel without webhookUrl', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: ['incoming_transaction'], alertConfig: { channel: 'webhook' } }))
      .toThrow('alertConfig.webhookUrl is required');
  });

  test('throws for email channel without email address', () => {
    expect(() => svc.createMonitor({ accountId: 'GABC', conditions: ['incoming_transaction'], alertConfig: { channel: 'email' } }))
      .toThrow('alertConfig.email is required');
  });
});

// =============================================================================
// createMonitor — success
// =============================================================================
describe('AccountMonitorService.createMonitor — success', () => {
  let stellar, svc;
  beforeEach(async () => {
    stellar = new MockStellarService();
    svc = new AccountMonitorService(stellar);
  });

  test('creates a monitor with correct shape', async () => {
    const { recipient } = await makeWallets(stellar);
    const m = svc.createMonitor(validMonitorBody(recipient.publicKey));
    expect(m).toMatchObject({
      accountId: recipient.publicKey,
      conditions: ['incoming_transaction'],
      active: true,
    });
    expect(m.id).toBeDefined();
    expect(m.createdAt).toBeDefined();
  });

  test('creates monitor with low_balance condition', async () => {
    const { recipient } = await makeWallets(stellar);
    const m = svc.createMonitor({
      accountId: recipient.publicKey,
      conditions: ['low_balance'],
      balanceThreshold: 100,
      alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' },
    });
    expect(m.balanceThreshold).toBe(100);
  });

  test('creates monitor with large_transaction condition', async () => {
    const { recipient } = await makeWallets(stellar);
    const m = svc.createMonitor({
      accountId: recipient.publicKey,
      conditions: ['large_transaction'],
      amountThreshold: 500,
      alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' },
    });
    expect(m.amountThreshold).toBe(500);
  });

  test('creates monitor with email channel', async () => {
    const { recipient } = await makeWallets(stellar);
    const m = svc.createMonitor({
      accountId: recipient.publicKey,
      conditions: ['incoming_transaction'],
      alertConfig: { channel: 'email', email: 'test@example.com' },
    });
    expect(m.alertConfig.channel).toBe('email');
  });

  test('multiple monitors can be created', async () => {
    const { recipient, donor } = await makeWallets(stellar);
    svc.createMonitor(validMonitorBody(recipient.publicKey));
    svc.createMonitor(validMonitorBody(donor.publicKey));
    expect(svc.listMonitors()).toHaveLength(2);
  });
});

// =============================================================================
// listMonitors / getMonitor / deleteMonitor
// =============================================================================
describe('AccountMonitorService CRUD', () => {
  let stellar, svc;
  beforeEach(async () => {
    stellar = new MockStellarService();
    svc = new AccountMonitorService(stellar);
  });

  test('listMonitors returns all monitors', async () => {
    const { recipient } = await makeWallets(stellar);
    svc.createMonitor(validMonitorBody(recipient.publicKey));
    svc.createMonitor(validMonitorBody(recipient.publicKey));
    expect(svc.listMonitors()).toHaveLength(2);
  });

  test('getMonitor returns the correct monitor', async () => {
    const { recipient } = await makeWallets(stellar);
    const m = svc.createMonitor(validMonitorBody(recipient.publicKey));
    expect(svc.getMonitor(m.id)).toEqual(m);
  });

  test('getMonitor throws for unknown id', () => {
    expect(() => svc.getMonitor('nonexistent')).toThrow('Monitor not found');
  });

  test('deleteMonitor removes the monitor', async () => {
    const { recipient } = await makeWallets(stellar);
    const m = svc.createMonitor(validMonitorBody(recipient.publicKey));
    svc.deleteMonitor(m.id);
    expect(svc.listMonitors()).toHaveLength(0);
  });

  test('deleteMonitor throws for unknown id', () => {
    expect(() => svc.deleteMonitor('nonexistent')).toThrow('Monitor not found');
  });
});

// =============================================================================
// Alert conditions — incoming_transaction
// =============================================================================
describe('Alert condition: incoming_transaction', () => {
  let stellar, svc;
  beforeEach(() => {
    axios.post.mockResolvedValue({ status: 200 });
    stellar = new MockStellarService();
    svc = new AccountMonitorService(stellar);
  });

  test('fires webhook alert when account receives a transaction', async () => {
    const { donor, recipient } = await makeWallets(stellar);
    svc.createMonitor(validMonitorBody(recipient.publicKey));

    await stellar.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '50',
      memo: 'test',
    });

    // Allow async alert delivery
    await new Promise(r => setTimeout(r, 20));

    const log = svc.getAlertLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    const entry = log.find(e => e.condition === 'incoming_transaction');
    expect(entry).toBeDefined();
    expect(entry.delivered).toBe(true);
    expect(axios.post).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ condition: 'incoming_transaction' }),
      expect.any(Object)
    );
  });

  test('does NOT fire for outgoing transaction on monitored account', async () => {
    const { donor, recipient } = await makeWallets(stellar);
    svc.createMonitor(validMonitorBody(donor.publicKey));

    await stellar.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '50',
      memo: 'test',
    });

    await new Promise(r => setTimeout(r, 20));

    const log = svc.getAlertLog().filter(e => e.condition === 'incoming_transaction');
    expect(log).toHaveLength(0);
  });
});

// =============================================================================
// Alert conditions — large_transaction
// =============================================================================
describe('Alert condition: large_transaction', () => {
  let stellar, svc;
  beforeEach(() => {
    axios.post.mockResolvedValue({ status: 200 });
    stellar = new MockStellarService();
    svc = new AccountMonitorService(stellar);
  });

  test('fires alert when transaction amount meets threshold', async () => {
    const { donor, recipient } = await makeWallets(stellar);
    svc.createMonitor({
      accountId: recipient.publicKey,
      conditions: ['large_transaction'],
      amountThreshold: 100,
      alertConfig: { channel: 'webhook', webhookUrl: 'https://example.com/hook' },
    });

    await stellar.sendDonation({ sourceSecret: donor.secretKey, destinationPublic: recipient.publicKey, amount: '200', memo: '' });
    await new Promise(r => setTimeout(r, 20));

    const entry = svc.getAlertLog().find(e => e.condition === 'large_transaction');
    expect(entry).toBeDefined();
    expect(entry.delivered).toBe(true);
  });

  test('does NOT fire when transaction is below threshold', async () => {
    const { donor, recipient } = await makeWallets(stellar);
    svc.createMonitor({
      accountId: recipient.publicKey,
      conditions: ['large_transaction'],
      amountThreshold: 1000,
      alertConfig: { channel: 'webhook', webhookUrl: 'https://example.com/hook' },
    });

    await stellar.sendDonation({ sourceSecret: donor.secretKey, destinationPublic: recipient.publicKey, amount: '50', memo: '' });
    await new Promise(r => setTimeout(r, 20));

    const entry = svc.getAlertLog().find(e => e.condition === 'large_transaction');
    expect(entry).toBeUndefined();
  });
});

// =============================================================================
// Alert conditions — low_balance
// =============================================================================
describe('Alert condition: low_balance', () => {
  let stellar, svc;
  beforeEach(() => {
    axios.post.mockResolvedValue({ status: 200 });
    stellar = new MockStellarService();
    svc = new AccountMonitorService(stellar);
  });

  test('fires alert when balance drops below threshold after transaction', async () => {
    const { donor, recipient } = await makeWallets(stellar);
    // donor starts at 10000, threshold 9000 — sending 2000 drops it to 8000
    svc.createMonitor({
      accountId: donor.publicKey,
      conditions: ['low_balance'],
      balanceThreshold: 9000,
      alertConfig: { channel: 'webhook', webhookUrl: 'https://example.com/hook' },
    });

    await stellar.sendDonation({ sourceSecret: donor.secretKey, destinationPublic: recipient.publicKey, amount: '2000', memo: '' });
    await new Promise(r => setTimeout(r, 20));

    const entry = svc.getAlertLog().find(e => e.condition === 'low_balance');
    expect(entry).toBeDefined();
    expect(entry.delivered).toBe(true);
  });

  test('does NOT fire when balance stays above threshold', async () => {
    const { donor, recipient } = await makeWallets(stellar);
    svc.createMonitor({
      accountId: donor.publicKey,
      conditions: ['low_balance'],
      balanceThreshold: 100,
      alertConfig: { channel: 'webhook', webhookUrl: 'https://example.com/hook' },
    });

    await stellar.sendDonation({ sourceSecret: donor.secretKey, destinationPublic: recipient.publicKey, amount: '50', memo: '' });
    await new Promise(r => setTimeout(r, 20));

    const entry = svc.getAlertLog().find(e => e.condition === 'low_balance');
    expect(entry).toBeUndefined();
  });
});

// =============================================================================
// Alert delivery — email channel
// =============================================================================
describe('Alert delivery: email channel', () => {
  test('logs email alert without calling axios', async () => {
    axios.post.mockClear();
    const stellar = new MockStellarService();
    const svc = new AccountMonitorService(stellar);
    const { donor, recipient } = await makeWallets(stellar);

    svc.createMonitor({
      accountId: recipient.publicKey,
      conditions: ['incoming_transaction'],
      alertConfig: { channel: 'email', email: 'admin@example.com' },
    });

    await stellar.sendDonation({ sourceSecret: donor.secretKey, destinationPublic: recipient.publicKey, amount: '10', memo: '' });
    await new Promise(r => setTimeout(r, 20));

    const entry = svc.getAlertLog().find(e => e.condition === 'incoming_transaction');
    expect(entry).toBeDefined();
    expect(entry.delivered).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Alert delivery — webhook failure handling
// =============================================================================
describe('Alert delivery: webhook failure', () => {
  test('logs failed delivery when webhook throws', async () => {
    axios.post.mockRejectedValue(new Error('network timeout'));
    const stellar = new MockStellarService();
    const svc = new AccountMonitorService(stellar);
    const { donor, recipient } = await makeWallets(stellar);

    svc.createMonitor(validMonitorBody(recipient.publicKey));
    await stellar.sendDonation({ sourceSecret: donor.secretKey, destinationPublic: recipient.publicKey, amount: '10', memo: '' });
    await new Promise(r => setTimeout(r, 20));

    const entry = svc.getAlertLog().find(e => e.condition === 'incoming_transaction');
    expect(entry).toBeDefined();
    expect(entry.delivered).toBe(false);
    expect(entry.error).toBe('network timeout');
  });
});

// =============================================================================
// deleteMonitor stops alert delivery
// =============================================================================
describe('deleteMonitor stops alerts', () => {
  test('no alerts fired after monitor is deleted', async () => {
    axios.post.mockResolvedValue({ status: 200 });
    const stellar = new MockStellarService();
    const svc = new AccountMonitorService(stellar);
    const { donor, recipient } = await makeWallets(stellar);

    const m = svc.createMonitor(validMonitorBody(recipient.publicKey));
    svc.deleteMonitor(m.id);

    await stellar.sendDonation({ sourceSecret: donor.secretKey, destinationPublic: recipient.publicKey, amount: '10', memo: '' });
    await new Promise(r => setTimeout(r, 20));

    expect(svc.getAlertLog()).toHaveLength(0);
  });
});

// =============================================================================
// REST API — POST /monitors
// =============================================================================
describe('POST /monitors', () => {
  let stellar, monSvc;
  beforeEach(() => {
    axios.post.mockResolvedValue({ status: 200 });
    stellar = new MockStellarService();
    monSvc = new AccountMonitorService(stellar);
    setMonitorService(monSvc);
  });

  test('201 with created monitor', async () => {
    const res = await request(app).post('/monitors').send(validMonitorBody('GABC123'));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe('GABC123');
  });

  test('400 for missing accountId', async () => {
    const res = await request(app).post('/monitors').send({ conditions: ['incoming_transaction'], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('400 for invalid condition', async () => {
    const res = await request(app).post('/monitors').send({ accountId: 'GABC', conditions: ['bad'], alertConfig: { channel: 'webhook', webhookUrl: 'https://x.com' } });
    expect(res.status).toBe(400);
  });

  test('400 for missing webhookUrl', async () => {
    const res = await request(app).post('/monitors').send({ accountId: 'GABC', conditions: ['incoming_transaction'], alertConfig: { channel: 'webhook' } });
    expect(res.status).toBe(400);
  });
});

// =============================================================================
// REST API — GET /monitors
// =============================================================================
describe('GET /monitors', () => {
  let monSvc;
  beforeEach(() => {
    monSvc = new AccountMonitorService(new MockStellarService());
    setMonitorService(monSvc);
  });

  test('200 with empty list', async () => {
    const res = await request(app).get('/monitors');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], count: 0 });
  });

  test('200 with monitors after creation', async () => {
    monSvc.createMonitor(validMonitorBody('GABC'));
    const res = await request(app).get('/monitors');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });
});

// =============================================================================
// REST API — GET /monitors/:id
// =============================================================================
describe('GET /monitors/:id', () => {
  let monSvc;
  beforeEach(() => {
    monSvc = new AccountMonitorService(new MockStellarService());
    setMonitorService(monSvc);
  });

  test('200 with monitor data', async () => {
    const m = monSvc.createMonitor(validMonitorBody('GABC'));
    const res = await request(app).get(`/monitors/${m.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(m.id);
  });

  test('404 for unknown id', async () => {
    const res = await request(app).get('/monitors/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// =============================================================================
// REST API — DELETE /monitors/:id
// =============================================================================
describe('DELETE /monitors/:id', () => {
  let monSvc;
  beforeEach(() => {
    monSvc = new AccountMonitorService(new MockStellarService());
    setMonitorService(monSvc);
  });

  test('200 on successful delete', async () => {
    const m = monSvc.createMonitor(validMonitorBody('GABC'));
    const res = await request(app).delete(`/monitors/${m.id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('404 for unknown id', async () => {
    const res = await request(app).delete('/monitors/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('monitor is gone after delete', async () => {
    const m = monSvc.createMonitor(validMonitorBody('GABC'));
    await request(app).delete(`/monitors/${m.id}`);
    const res = await request(app).get(`/monitors/${m.id}`);
    expect(res.status).toBe(404);
  });
});
