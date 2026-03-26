/**
 * Payment Channels Tests
 *
 * Covers:
 *  - Channel open (success + validation errors)
 *  - Off-chain state updates (success, bad sig, over-capacity, wrong status)
 *  - On-chain settlement (success, zero-balance, already settled)
 *  - Dispute handling (success, expired window, stale sequence, bad sig)
 *  - Force-close / timeout
 *  - Signing helpers (sign, verify, canonical message)
 *  - Full channel lifecycle end-to-end
 */

'use strict';

process.env.MOCK_STELLAR = 'true';
process.env.NODE_ENV = 'test';
process.env.API_KEYS = 'test-key-channels';

const {
  PaymentChannelService,
  signState,
  verifyStateSignature,
  buildStateMessage,
  DISPUTE_WINDOW_MS,
  CHANNEL_TIMEOUT_MS,
} = require('../src/services/PaymentChannelService');
const Database = require('../src/utils/database');

// ─── Mock stellar service ─────────────────────────────────────────────────────

const mockStellarService = {
  sendPayment: jest.fn(async (from, to, amount, memo) => ({
    transactionId: `mock-tx-${Date.now()}`,
    hash: `mock-hash-${Date.now()}`,
  })),
};

// ─── Test keys (deterministic for reproducibility) ───────────────────────────

const SENDER_SECRET = 'sender-secret-key-abc123';
const RECEIVER_SECRET = 'receiver-secret-key-xyz789';
const SENDER_KEY = 'GSENDER_PUBLIC_KEY';
const RECEIVER_KEY = 'GRECEIVER_PUBLIC_KEY';

// ─── Setup ────────────────────────────────────────────────────────────────────

let service;

beforeAll(async () => {
  await Database.initialize();
  service = new PaymentChannelService(mockStellarService);
  await service.initTable();
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await Database.close();
});

// ─── Signing helpers ──────────────────────────────────────────────────────────

describe('Signing helpers', () => {
  test('buildStateMessage produces canonical string', () => {
    expect(buildStateMessage('ch-1', 3, 50)).toBe('channel:ch-1:seq:3:balance:50');
  });

  test('signState returns a hex string', () => {
    const sig = signState('hello', 'secret');
    expect(typeof sig).toBe('string');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  test('verifyStateSignature returns true for correct signature', () => {
    const msg = buildStateMessage('ch-1', 1, 10);
    const sig = signState(msg, SENDER_SECRET);
    expect(verifyStateSignature(msg, sig, SENDER_SECRET)).toBe(true);
  });

  test('verifyStateSignature returns false for wrong secret', () => {
    const msg = buildStateMessage('ch-1', 1, 10);
    const sig = signState(msg, SENDER_SECRET);
    expect(verifyStateSignature(msg, sig, 'wrong-secret')).toBe(false);
  });

  test('verifyStateSignature returns false for tampered message', () => {
    const msg = buildStateMessage('ch-1', 1, 10);
    const sig = signState(msg, SENDER_SECRET);
    expect(verifyStateSignature('tampered', sig, SENDER_SECRET)).toBe(false);
  });

  test('verifyStateSignature returns false for malformed signature', () => {
    const msg = buildStateMessage('ch-1', 1, 10);
    expect(verifyStateSignature(msg, 'not-hex', SENDER_SECRET)).toBe(false);
  });
});

// ─── Open channel ─────────────────────────────────────────────────────────────

describe('openChannel', () => {
  test('creates a channel with correct initial state', async () => {
    const ch = await service.openChannel({
      senderKey: SENDER_KEY,
      receiverKey: RECEIVER_KEY,
      capacity: 100,
    });

    expect(ch.id).toBeDefined();
    expect(ch.senderKey).toBe(SENDER_KEY);
    expect(ch.receiverKey).toBe(RECEIVER_KEY);
    expect(ch.capacity).toBe(100);
    expect(ch.balance).toBe(0);
    expect(ch.sequence).toBe(0);
    expect(ch.status).toBe('open');
    expect(ch.signatures).toEqual([]);
  });

  test('stores optional metadata', async () => {
    const ch = await service.openChannel({
      senderKey: SENDER_KEY,
      receiverKey: RECEIVER_KEY,
      capacity: 50,
      metadata: { purpose: 'tips' },
    });
    expect(ch.metadata).toEqual({ purpose: 'tips' });
  });

  test('throws if senderKey is missing', async () => {
    await expect(service.openChannel({ receiverKey: RECEIVER_KEY, capacity: 10 }))
      .rejects.toThrow('senderKey is required');
  });

  test('throws if receiverKey is missing', async () => {
    await expect(service.openChannel({ senderKey: SENDER_KEY, capacity: 10 }))
      .rejects.toThrow('receiverKey is required');
  });

  test('throws if sender and receiver are the same', async () => {
    await expect(service.openChannel({ senderKey: SENDER_KEY, receiverKey: SENDER_KEY, capacity: 10 }))
      .rejects.toThrow('must be different');
  });

  test('throws if capacity is zero', async () => {
    await expect(service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 0 }))
      .rejects.toThrow('capacity must be a positive number');
  });

  test('throws if capacity is negative', async () => {
    await expect(service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: -5 }))
      .rejects.toThrow('capacity must be a positive number');
  });
});

// ─── Get / list channels ──────────────────────────────────────────────────────

describe('getChannel / listChannels', () => {
  test('getChannel returns the channel by id', async () => {
    const created = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 20 });
    const fetched = await service.getChannel(created.id);
    expect(fetched.id).toBe(created.id);
  });

  test('getChannel throws NotFoundError for unknown id', async () => {
    await expect(service.getChannel('non-existent-id')).rejects.toThrow('not found');
  });

  test('listChannels returns all channels', async () => {
    const all = await service.listChannels();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
  });

  test('listChannels filters by status', async () => {
    const open = await service.listChannels('open');
    expect(open.every((c) => c.status === 'open')).toBe(true);
  });
});

// ─── Update channel (off-chain) ───────────────────────────────────────────────

describe('updateChannel', () => {
  let channel;

  beforeEach(async () => {
    channel = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });
  });

  function makeSigs(channelId, seq, balance) {
    const msg = buildStateMessage(channelId, seq, balance);
    return {
      senderSig: signState(msg, SENDER_SECRET),
      receiverSig: signState(msg, RECEIVER_SECRET),
    };
  }

  test('advances sequence and balance with valid signatures', async () => {
    const { senderSig, receiverSig } = makeSigs(channel.id, 1, 10);
    const updated = await service.updateChannel({
      channelId: channel.id,
      amount: 10,
      senderSecret: SENDER_SECRET,
      receiverSecret: RECEIVER_SECRET,
      senderSig,
      receiverSig,
    });
    expect(updated.sequence).toBe(1);
    expect(updated.balance).toBe(10);
    expect(updated.signatures).toHaveLength(1);
  });

  test('accumulates multiple updates', async () => {
    const s1 = makeSigs(channel.id, 1, 10);
    await service.updateChannel({ channelId: channel.id, amount: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...s1 });

    const s2 = makeSigs(channel.id, 2, 25);
    const updated = await service.updateChannel({ channelId: channel.id, amount: 15, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...s2 });

    expect(updated.sequence).toBe(2);
    expect(updated.balance).toBe(25);
    expect(updated.signatures).toHaveLength(2);
  });

  test('throws if amount exceeds remaining capacity', async () => {
    const { senderSig, receiverSig } = makeSigs(channel.id, 1, 200);
    await expect(
      service.updateChannel({ channelId: channel.id, amount: 200, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, senderSig, receiverSig })
    ).rejects.toThrow('exceed channel capacity');
  });

  test('throws if sender signature is invalid', async () => {
    const { receiverSig } = makeSigs(channel.id, 1, 10);
    await expect(
      service.updateChannel({ channelId: channel.id, amount: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, senderSig: 'bad', receiverSig })
    ).rejects.toThrow('Invalid sender signature');
  });

  test('throws if receiver signature is invalid', async () => {
    const { senderSig } = makeSigs(channel.id, 1, 10);
    await expect(
      service.updateChannel({ channelId: channel.id, amount: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, senderSig, receiverSig: 'bad' })
    ).rejects.toThrow('Invalid receiver signature');
  });

  test('throws if channel is not open', async () => {
    // Settle the channel first
    await service.settleChannel({ channelId: channel.id, senderSecret: SENDER_SECRET });
    const { senderSig, receiverSig } = makeSigs(channel.id, 1, 5);
    await expect(
      service.updateChannel({ channelId: channel.id, amount: 5, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, senderSig, receiverSig })
    ).rejects.toThrow('settled');
  });

  test('throws if amount is zero', async () => {
    await expect(
      service.updateChannel({ channelId: channel.id, amount: 0, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, senderSig: 'x', receiverSig: 'x' })
    ).rejects.toThrow('amount must be a positive number');
  });
});

// ─── Settle channel ───────────────────────────────────────────────────────────

describe('settleChannel', () => {
  test('settles channel and calls sendPayment when balance > 0', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 50 });
    const msg = buildStateMessage(ch.id, 1, 20);
    const sigs = { senderSig: signState(msg, SENDER_SECRET), receiverSig: signState(msg, RECEIVER_SECRET) };
    await service.updateChannel({ channelId: ch.id, amount: 20, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...sigs });

    const settled = await service.settleChannel({ channelId: ch.id, senderSecret: SENDER_SECRET });

    expect(settled.status).toBe('settled');
    expect(settled.settledAt).toBeDefined();
    expect(mockStellarService.sendPayment).toHaveBeenCalledWith(
      SENDER_KEY, RECEIVER_KEY, '20', expect.stringContaining('channel-settle')
    );
  });

  test('settles channel without calling sendPayment when balance is 0', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 50 });
    const settled = await service.settleChannel({ channelId: ch.id, senderSecret: SENDER_SECRET });

    expect(settled.status).toBe('settled');
    expect(mockStellarService.sendPayment).not.toHaveBeenCalled();
  });

  test('throws if channel is already settled', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 50 });
    await service.settleChannel({ channelId: ch.id, senderSecret: SENDER_SECRET });
    await expect(service.settleChannel({ channelId: ch.id, senderSecret: SENDER_SECRET }))
      .rejects.toThrow('already settled');
  });

  test('throws if senderSecret is missing', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 50 });
    await expect(service.settleChannel({ channelId: ch.id })).rejects.toThrow('senderSecret is required');
  });
});

// ─── Dispute channel ──────────────────────────────────────────────────────────

describe('disputeChannel', () => {
  test('raises dispute with valid higher-sequence state', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });

    // Apply one off-chain update
    const msg1 = buildStateMessage(ch.id, 1, 10);
    const s1 = { senderSig: signState(msg1, SENDER_SECRET), receiverSig: signState(msg1, RECEIVER_SECRET) };
    await service.updateChannel({ channelId: ch.id, amount: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...s1 });

    // Dispute with sequence 2 (higher than current 1)
    const disputeBalance = 30;
    const msg2 = buildStateMessage(ch.id, 2, disputeBalance);
    const s2 = { senderSig: signState(msg2, SENDER_SECRET), receiverSig: signState(msg2, RECEIVER_SECRET) };

    const disputed = await service.disputeChannel({
      channelId: ch.id,
      sequence: 2,
      balance: disputeBalance,
      senderSecret: SENDER_SECRET,
      receiverSecret: RECEIVER_SECRET,
      ...s2,
    });

    expect(disputed.status).toBe('disputed');
    expect(disputed.sequence).toBe(2);
    expect(disputed.balance).toBe(30);
    expect(disputed.disputedAt).toBeDefined();
  });

  test('throws if dispute sequence is not higher than current', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });
    const msg = buildStateMessage(ch.id, 0, 0);
    const sigs = { senderSig: signState(msg, SENDER_SECRET), receiverSig: signState(msg, RECEIVER_SECRET) };

    await expect(
      service.disputeChannel({ channelId: ch.id, sequence: 0, balance: 0, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...sigs })
    ).rejects.toThrow('must be greater than current sequence');
  });

  test('throws if dispute window has expired', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });

    // Backdate updatedAt beyond the dispute window
    const expired = new Date(Date.now() - DISPUTE_WINDOW_MS - 1000).toISOString();
    await Database.run('UPDATE payment_channels SET updatedAt = ? WHERE id = ?', [expired, ch.id]);

    const msg = buildStateMessage(ch.id, 1, 10);
    const sigs = { senderSig: signState(msg, SENDER_SECRET), receiverSig: signState(msg, RECEIVER_SECRET) };

    await expect(
      service.disputeChannel({ channelId: ch.id, sequence: 1, balance: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...sigs })
    ).rejects.toThrow('Dispute window has expired');
  });

  test('throws if dispute sender signature is invalid', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });
    const msg = buildStateMessage(ch.id, 1, 10);
    const receiverSig = signState(msg, RECEIVER_SECRET);

    await expect(
      service.disputeChannel({ channelId: ch.id, sequence: 1, balance: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, senderSig: 'bad', receiverSig })
    ).rejects.toThrow('Invalid sender signature');
  });

  test('throws if channel status is not open or settled', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });
    await Database.run("UPDATE payment_channels SET status = 'closed' WHERE id = ?", [ch.id]);

    const msg = buildStateMessage(ch.id, 1, 10);
    const sigs = { senderSig: signState(msg, SENDER_SECRET), receiverSig: signState(msg, RECEIVER_SECRET) };

    await expect(
      service.disputeChannel({ channelId: ch.id, sequence: 1, balance: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...sigs })
    ).rejects.toThrow("Cannot dispute a channel with status 'closed'");
  });
});

// ─── Close / timeout ──────────────────────────────────────────────────────────

describe('closeChannel', () => {
  test('force-closes a timed-out channel and settles balance', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });

    // Apply an update so balance > 0
    const msg = buildStateMessage(ch.id, 1, 15);
    const sigs = { senderSig: signState(msg, SENDER_SECRET), receiverSig: signState(msg, RECEIVER_SECRET) };
    await service.updateChannel({ channelId: ch.id, amount: 15, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...sigs });

    // Backdate updatedAt beyond timeout
    const expired = new Date(Date.now() - CHANNEL_TIMEOUT_MS - 1000).toISOString();
    await Database.run('UPDATE payment_channels SET updatedAt = ? WHERE id = ?', [expired, ch.id]);

    const closed = await service.closeChannel({ channelId: ch.id, senderSecret: SENDER_SECRET });

    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBeDefined();
    expect(mockStellarService.sendPayment).toHaveBeenCalledWith(
      SENDER_KEY, RECEIVER_KEY, '15', expect.stringContaining('channel-close')
    );
  });

  test('throws if channel has not timed out and is still open', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });
    await expect(service.closeChannel({ channelId: ch.id, senderSecret: SENDER_SECRET }))
      .rejects.toThrow('has not timed out yet');
  });

  test('throws if channel is already closed', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });
    await Database.run("UPDATE payment_channels SET status = 'closed' WHERE id = ?", [ch.id]);
    await expect(service.closeChannel({ channelId: ch.id, senderSecret: SENDER_SECRET }))
      .rejects.toThrow('already closed');
  });

  test('throws if senderSecret is missing', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });
    await expect(service.closeChannel({ channelId: ch.id })).rejects.toThrow('senderSecret is required');
  });
});

// ─── Full lifecycle end-to-end ────────────────────────────────────────────────

describe('Full channel lifecycle', () => {
  test('open → multiple updates → settle', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 200 });
    expect(ch.status).toBe('open');
    expect(ch.balance).toBe(0);

    // 3 off-chain micro-donations
    for (let i = 1; i <= 3; i++) {
      const msg = buildStateMessage(ch.id, i, i * 10);
      const sigs = { senderSig: signState(msg, SENDER_SECRET), receiverSig: signState(msg, RECEIVER_SECRET) };
      await service.updateChannel({ channelId: ch.id, amount: 10, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...sigs });
    }

    const afterUpdates = await service.getChannel(ch.id);
    expect(afterUpdates.sequence).toBe(3);
    expect(afterUpdates.balance).toBe(30);
    expect(afterUpdates.signatures).toHaveLength(3);

    // Settle on-chain
    const settled = await service.settleChannel({ channelId: ch.id, senderSecret: SENDER_SECRET });
    expect(settled.status).toBe('settled');
    expect(mockStellarService.sendPayment).toHaveBeenCalledTimes(1);
    expect(mockStellarService.sendPayment).toHaveBeenCalledWith(SENDER_KEY, RECEIVER_KEY, '30', expect.any(String));
  });

  test('open → update → dispute with higher state → settle', async () => {
    const ch = await service.openChannel({ senderKey: SENDER_KEY, receiverKey: RECEIVER_KEY, capacity: 100 });

    // One acknowledged update
    const msg1 = buildStateMessage(ch.id, 1, 5);
    const s1 = { senderSig: signState(msg1, SENDER_SECRET), receiverSig: signState(msg1, RECEIVER_SECRET) };
    await service.updateChannel({ channelId: ch.id, amount: 5, senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...s1 });

    // Dispute with a higher state (seq 2, balance 40)
    const msg2 = buildStateMessage(ch.id, 2, 40);
    const s2 = { senderSig: signState(msg2, SENDER_SECRET), receiverSig: signState(msg2, RECEIVER_SECRET) };
    const disputed = await service.disputeChannel({
      channelId: ch.id, sequence: 2, balance: 40,
      senderSecret: SENDER_SECRET, receiverSecret: RECEIVER_SECRET, ...s2,
    });
    expect(disputed.status).toBe('disputed');
    expect(disputed.balance).toBe(40);

    // Settle the disputed channel
    const settled = await service.settleChannel({ channelId: ch.id, senderSecret: SENDER_SECRET });
    expect(settled.status).toBe('settled');
    expect(mockStellarService.sendPayment).toHaveBeenCalledWith(SENDER_KEY, RECEIVER_KEY, '40', expect.any(String));
  });
});
