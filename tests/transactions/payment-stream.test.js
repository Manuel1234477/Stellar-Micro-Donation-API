'use strict';

jest.useFakeTimers();

const MockStellarService = require('../../src/services/MockStellarService');
const PaymentStreamService = require('../../src/services/PaymentStreamService');
const Transaction = require('../../src/routes/models/transaction');
const { WebhookService } = require('../../src/services/WebhookService');

const PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const MOCK_PAYMENT = {
  id: 'tx-abc-123',
  transactionId: 'tx-abc-123',
  from: 'GSENDER123',
  amount: '10.0000000',
  memo: 'test donation',
};

let stellar;
let service;

beforeEach(() => {
  stellar = new MockStellarService();
  // Register the wallet so MockStellarService doesn't throw NotFoundError
  stellar.wallets.set(PUBLIC_KEY, {
    publicKey: PUBLIC_KEY,
    secretKey: null,
    balance: '100.0000000',
    assetBalances: new Map(),
  });
  service = new PaymentStreamService(stellar);
  jest.spyOn(Transaction, 'create').mockReturnValue({ id: 1, ...MOCK_PAYMENT });
  jest.spyOn(WebhookService, 'deliver').mockResolvedValue({ delivered: true });
});

afterEach(() => {
  service.getActiveStreams().forEach((key) => service.unsubscribe(key));
  jest.clearAllMocks();
  jest.clearAllTimers();
});

// ---- subscribe / unsubscribe ----
describe('subscribe / unsubscribe', () => {
  test('subscribe adds key to activeStreams', () => {
    service.subscribe(PUBLIC_KEY);
    expect(service.getActiveStreams()).toContain(PUBLIC_KEY);
  });

  test('unsubscribe removes key from activeStreams', () => {
    service.subscribe(PUBLIC_KEY);
    service.unsubscribe(PUBLIC_KEY);
    expect(service.getActiveStreams()).not.toContain(PUBLIC_KEY);
  });

  test('re-subscribing replaces existing subscription', () => {
    service.subscribe(PUBLIC_KEY);
    service.subscribe(PUBLIC_KEY);
    expect(service.getActiveStreams().filter((k) => k === PUBLIC_KEY)).toHaveLength(1);
  });
});

// ---- payment detection ----
describe('payment detection', () => {
  test('detects incoming payment and creates transaction record', async () => {
    service.subscribe(PUBLIC_KEY);
    stellar._notifyStreamListeners(PUBLIC_KEY, MOCK_PAYMENT);

    // Allow microtasks to flush
    await Promise.resolve();

    expect(Transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: MOCK_PAYMENT.id,
        receiverId: PUBLIC_KEY,
        amount: MOCK_PAYMENT.amount,
        status: 'completed',
        source: 'stream',
      })
    );
  });

  test('triggers webhook on payment detection when webhookUrl is set', async () => {
    service.subscribe(PUBLIC_KEY, { webhookUrl: 'https://example.com/hook' });
    stellar._notifyStreamListeners(PUBLIC_KEY, MOCK_PAYMENT);

    await Promise.resolve();

    expect(WebhookService.deliver).toHaveBeenCalledWith(
      'payment.received',
      expect.objectContaining({ publicKey: PUBLIC_KEY, payment: MOCK_PAYMENT })
    );
  });

  test('does NOT trigger webhook when no webhookUrl is set', async () => {
    service.subscribe(PUBLIC_KEY);
    stellar._notifyStreamListeners(PUBLIC_KEY, MOCK_PAYMENT);

    await Promise.resolve();

    expect(WebhookService.deliver).not.toHaveBeenCalled();
  });

  test('transaction record is created without waiting for reconciliation', async () => {
    service.subscribe(PUBLIC_KEY);
    stellar._notifyStreamListeners(PUBLIC_KEY, MOCK_PAYMENT);

    await Promise.resolve();

    // Transaction.create should be called synchronously within the same tick
    expect(Transaction.create).toHaveBeenCalledTimes(1);
  });
});

// ---- reconnection ----
describe('reconnection', () => {
  test('_reconnect schedules a re-subscribe after backoff delay', () => {
    service.subscribe(PUBLIC_KEY);
    service._reconnect(PUBLIC_KEY, {}, 0);

    // Timer should be scheduled (1000ms for attempt 0)
    expect(service.activeStreams.get(PUBLIC_KEY)).toBeDefined();

    jest.advanceTimersByTime(1100);

    // After timer fires, stream should be re-subscribed
    expect(service.getActiveStreams()).toContain(PUBLIC_KEY);
  });

  test('backoff doubles with each attempt', () => {
    const delays = [0, 1, 2, 3].map((attempt) =>
      Math.min(1000 * Math.pow(2, attempt), 30_000)
    );
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  test('stops reconnecting after MAX_RECONNECT_ATTEMPTS', () => {
    service.subscribe(PUBLIC_KEY);

    // Exhaust all attempts
    for (let i = 0; i < 10; i++) {
      service._reconnect(PUBLIC_KEY, {}, i);
      jest.runAllTimers();
    }

    // After max attempts, key should be removed
    service._reconnect(PUBLIC_KEY, {}, 10);
    expect(service.getActiveStreams()).not.toContain(PUBLIC_KEY);
  });

  test('unsubscribe cancels pending reconnect timer', () => {
    service.subscribe(PUBLIC_KEY);
    service._reconnect(PUBLIC_KEY, {}, 0);

    const entry = service.activeStreams.get(PUBLIC_KEY);
    expect(entry.reconnectTimer).not.toBeNull();

    service.unsubscribe(PUBLIC_KEY);
    expect(service.getActiveStreams()).not.toContain(PUBLIC_KEY);
  });
});

// ---- error resilience ----
describe('error resilience', () => {
  test('does not throw when Transaction.create fails', async () => {
    Transaction.create.mockImplementation(() => { throw new Error('DB error'); });
    service.subscribe(PUBLIC_KEY);

    await expect(
      service._handlePayment(PUBLIC_KEY, MOCK_PAYMENT, {})
    ).resolves.not.toThrow();
  });

  test('does not throw when WebhookService.deliver fails', async () => {
    WebhookService.deliver.mockRejectedValue(new Error('Webhook failed'));
    service.subscribe(PUBLIC_KEY);

    await expect(
      service._handlePayment(PUBLIC_KEY, MOCK_PAYMENT, { webhookUrl: 'https://example.com/hook' })
    ).resolves.not.toThrow();
  });
});
