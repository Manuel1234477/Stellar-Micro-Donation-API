const Transaction = require('../src/routes/models/transaction');
const donationEvents = require('../src/events/donationEvents');

describe('Transaction lifecycle event emission', () => {
  beforeEach(() => {
    Transaction._clearAllData();
    donationEvents.removeAllListeners();
  });

  afterEach(() => {
    Transaction._clearAllData();
    donationEvents.removeAllListeners();
  });

  test('emits donation.created when a new transaction is created', () => {
    const handler = jest.fn();
    donationEvents.on(donationEvents.constructor.EVENTS.CREATED, handler);

    const transaction = Transaction.create({
      amount: 10,
      donor: 'GDONORXXXXXXXXXXXXXXX',
      recipient: 'GRECIPIENTXXXXXXXXXXXX',
      status: 'pending',
    });

    expect(transaction).toBeDefined();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(transaction);
  });

  test('does not emit donation.created again for an idempotent replay', () => {
    const handler = jest.fn();
    donationEvents.on(donationEvents.constructor.EVENTS.CREATED, handler);

    const payload = {
      idempotencyKey: 'idem-key-123',
      amount: 15,
      donor: 'GDONORXXXXXXXXXXXXXXX',
      recipient: 'GRECIPIENTXXXXXXXXXXXX',
      status: 'pending',
    };

    const firstTx = Transaction.create(payload);
    const secondTx = Transaction.create(payload);

    expect(firstTx).toBeDefined();
    expect(secondTx).toBeDefined();
    expect(secondTx.id).toBe(firstTx.id);
    expect(secondTx.idempotencyKey).toBe(firstTx.idempotencyKey);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
