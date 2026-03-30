/**
 * Tests: Stellar Soroban Smart Contracts
 * Covers: MockStellarService contract methods, EscrowContract, GET /contracts/:id/events
 * Uses only MockStellarService — no live network calls.
 */

const fc = require('fast-check');
const request = require('supertest');

const MockStellarService = require('../../src/services/MockStellarService');
const StellarService = require('../../src/services/StellarService');
const EscrowContract = require('../../src/contracts/EscrowContract');

// ─── App setup for route tests ────────────────────────────────────────────────
// Override getStellarService so the route uses a fresh MockStellarService per test
let mockServiceInstance;
jest.mock('../src/config/stellar', () => ({
  getStellarService: () => mockServiceInstance,
  useMockStellar: true,
}));

const app = require('../../src/routes/app');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function freshMock() {
  mockServiceInstance = new MockStellarService();
  return mockServiceInstance;
}

// =============================================================================
// MockStellarService — invokeContract
// =============================================================================
describe('MockStellarService.invokeContract', () => {
  let service;
  beforeEach(() => { service = freshMock(); });

  test('deposit returns status:success and a deposit event', async () => {
    const result = await service.invokeContract('C001', 'deposit', ['donor1', 50]);
    expect(result.status).toBe('success');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('deposit');
  });

  test('release succeeds when balance meets goal', async () => {
    await service.invokeContract('C001', 'deposit', ['donor1', 100]);
    const result = await service.invokeContract('C001', 'release', ['recipient1', 100]);
    expect(result.status).toBe('success');
    expect(result.events[0].type).toBe('release');
  });

  test('release returns error when balance is below goal', async () => {
    await service.invokeContract('C001', 'deposit', ['donor1', 10]);
    const result = await service.invokeContract('C001', 'release', ['recipient1', 100]);
    expect(result.status).toBe('error');
    expect(result.returnValue).toBe('Goal not yet reached');
    expect(result.events).toHaveLength(0);
  });

  test('unknown method returns status:success with no events', async () => {
    const result = await service.invokeContract('C001', 'ping', []);
    expect(result.status).toBe('success');
    expect(result.events).toHaveLength(0);
  });

  test('throws when contractId is missing', async () => {
    await expect(service.invokeContract('', 'deposit', [])).rejects.toThrow('contractId is required');
    await expect(service.invokeContract(null, 'deposit', [])).rejects.toThrow('contractId is required');
    await expect(service.invokeContract(undefined, 'deposit', [])).rejects.toThrow('contractId is required');
  });

  test('throws when method is missing', async () => {
    await expect(service.invokeContract('C001', '', [])).rejects.toThrow('method is required');
    await expect(service.invokeContract('C001', null, [])).rejects.toThrow('method is required');
  });

  test('throws when args is not an array', async () => {
    await expect(service.invokeContract('C001', 'deposit', 'bad')).rejects.toThrow('args must be an array');
    await expect(service.invokeContract('C001', 'deposit', 42)).rejects.toThrow('args must be an array');
  });
});

// =============================================================================
// MockStellarService — getContractEvents
// =============================================================================
describe('MockStellarService.getContractEvents', () => {
  let service;
  beforeEach(() => { service = freshMock(); });

  test('returns empty array when no events exist', async () => {
    const events = await service.getContractEvents('C999');
    expect(events).toEqual([]);
  });

  test('returns events in reverse-chronological order', async () => {
    await service.invokeContract('C001', 'deposit', ['d1', 10]);
    await service.invokeContract('C001', 'deposit', ['d2', 20]);
    const events = await service.getContractEvents('C001');
    expect(events).toHaveLength(2);
    // Most recent first — second deposit ledger > first deposit ledger
    expect(events[0].data.amount).toBe(20);
    expect(events[1].data.amount).toBe(10);
  });

  test('respects limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await service.invokeContract('C001', 'deposit', [`d${i}`, i + 1]);
    }
    const events = await service.getContractEvents('C001', 2);
    expect(events).toHaveLength(2);
  });

  test('returns all events when limit exceeds count', async () => {
    await service.invokeContract('C001', 'deposit', ['d1', 10]);
    const events = await service.getContractEvents('C001', 100);
    expect(events).toHaveLength(1);
  });

  test('throws when contractId is missing', async () => {
    await expect(service.getContractEvents('')).rejects.toThrow('contractId is required');
    await expect(service.getContractEvents(null)).rejects.toThrow('contractId is required');
  });

  test('does not return events from a different contractId', async () => {
    await service.invokeContract('C001', 'deposit', ['d1', 10]);
    const events = await service.getContractEvents('C002');
    expect(events).toHaveLength(0);
  });
});

// =============================================================================
// EscrowContract
// =============================================================================
describe('EscrowContract', () => {
  test('constructor throws for non-positive goalAmount', () => {
    expect(() => new EscrowContract(0)).toThrow('goalAmount must be positive');
    expect(() => new EscrowContract(-5)).toThrow('goalAmount must be positive');
  });

  test('getState returns correct initial shape', () => {
    const c = new EscrowContract(100);
    const state = c.getState();
    expect(state).toEqual({ balance: 0, goalAmount: 100, donors: {}, released: false });
  });

  test('deposit accumulates balance and records donor', () => {
    const c = new EscrowContract(100);
    c.deposit('alice', 40);
    c.deposit('alice', 30);
    c.deposit('bob', 20);
    const state = c.getState();
    expect(state.balance).toBe(90);
    expect(state.donors.alice).toBe(70);
    expect(state.donors.bob).toBe(20);
  });

  test('deposit throws for non-positive amount', () => {
    const c = new EscrowContract(100);
    expect(() => c.deposit('alice', 0)).toThrow('amount must be positive');
    expect(() => c.deposit('alice', -1)).toThrow('amount must be positive');
  });

  test('release throws when goal not reached', () => {
    const c = new EscrowContract(100);
    c.deposit('alice', 50);
    expect(() => c.release('recipient')).toThrow('Goal not yet reached');
  });

  test('release succeeds when goal is met and returns correct shape', () => {
    const c = new EscrowContract(100);
    c.deposit('alice', 100);
    const result = c.release('recipient');
    expect(result.recipientId).toBe('recipient');
    expect(result.amount).toBe(100);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('release');
  });

  test('release succeeds when balance exceeds goal', () => {
    const c = new EscrowContract(100);
    c.deposit('alice', 150);
    const result = c.release('recipient');
    expect(result.amount).toBe(150);
  });

  test('balance is zero after release', () => {
    const c = new EscrowContract(50);
    c.deposit('alice', 50);
    c.release('recipient');
    expect(c.getState().balance).toBe(0);
    expect(c.getState().released).toBe(true);
  });
});

// =============================================================================
// StellarService — constructor validation
// =============================================================================
describe('StellarService constructor', () => {
  test('defaults sorobanRpcUrl when not provided', () => {
    const s = new StellarService();
    expect(s.sorobanRpcUrl).toBe('https://soroban-testnet.stellar.org');
  });

  test('accepts custom sorobanRpcUrl', () => {
    const s = new StellarService({ sorobanRpcUrl: 'https://custom.rpc' });
    expect(s.sorobanRpcUrl).toBe('https://custom.rpc');
  });

  test('throws when sorobanRpcUrl is empty string', () => {
    expect(() => new StellarService({ sorobanRpcUrl: '' })).toThrow('sorobanRpcUrl must not be empty');
  });
});

// =============================================================================
// StellarService — invokeContract / getContractEvents validation
// =============================================================================
describe('StellarService validation', () => {
  let service;
  beforeEach(() => { service = new StellarService(); });

  test('invokeContract throws for missing contractId', async () => {
    await expect(service.invokeContract('', 'deposit', [])).rejects.toThrow('contractId is required');
  });

  test('invokeContract throws for missing method', async () => {
    await expect(service.invokeContract('C001', '', [])).rejects.toThrow('method is required');
  });

  test('invokeContract throws for non-array args', async () => {
    await expect(service.invokeContract('C001', 'deposit', 'bad')).rejects.toThrow('args must be an array');
  });

  test('getContractEvents throws for missing contractId', async () => {
    await expect(service.getContractEvents('')).rejects.toThrow('contractId is required');
  });

  test('getContractEvents returns empty array for unknown contract', async () => {
    const events = await service.getContractEvents('UNKNOWN');
    expect(events).toEqual([]);
  });
});

// =============================================================================
// GET /contracts/:id/events — route tests
// =============================================================================
describe('GET /contracts/:id/events', () => {
  beforeEach(() => { freshMock(); });

  test('200 with empty data when no events exist', async () => {
    const res = await request(app).get('/contracts/C999/events');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: [], count: 0 });
  });

  test('200 with events after deposits', async () => {
    await mockServiceInstance.invokeContract('C001', 'deposit', ['d1', 50]);
    await mockServiceInstance.invokeContract('C001', 'deposit', ['d2', 30]);
    const res = await request(app).get('/contracts/C001/events');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.data).toHaveLength(2);
  });

  test('count equals data.length', async () => {
    await mockServiceInstance.invokeContract('C001', 'deposit', ['d1', 10]);
    const res = await request(app).get('/contracts/C001/events');
    expect(res.body.count).toBe(res.body.data.length);
  });

  test('limit query param filters results', async () => {
    for (let i = 0; i < 5; i++) {
      await mockServiceInstance.invokeContract('C001', 'deposit', [`d${i}`, 10]);
    }
    const res = await request(app).get('/contracts/C001/events?limit=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.count).toBe(2);
  });

  test('400 for non-integer limit', async () => {
    const res = await request(app).get('/contracts/C001/events?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  test('400 for zero limit', async () => {
    const res = await request(app).get('/contracts/C001/events?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  test('400 for negative limit', async () => {
    const res = await request(app).get('/contracts/C001/events?limit=-1');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  test('400 for float limit', async () => {
    const res = await request(app).get('/contracts/C001/events?limit=1.5');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST');
  });

  test('500 when service throws', async () => {
    mockServiceInstance.getContractEvents = async () => { throw new Error('DB exploded'); };
    const res = await request(app).get('/contracts/C001/events');
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FETCH_EVENTS_FAILED');
    expect(res.body.error.message).toBe('DB exploded');
  });
});

// =============================================================================
// Property-Based Tests
// =============================================================================

// Property 3: Deposit accumulation invariant
// Feature: stellar-soroban-smart-contracts, Property 3
describe('PBT — Property 3: Deposit accumulation invariant', () => {
  test('balance equals sum of all deposited amounts', () => {
    // Validates: Requirements 5.2, 5.6
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 20 }),
        (amounts) => {
          const c = new EscrowContract(Number.MAX_SAFE_INTEGER);
          amounts.forEach((a, i) => c.deposit(`donor${i}`, a));
          const expected = amounts.reduce((s, a) => s + a, 0);
          expect(c.getState().balance).toBe(expected);
        }
      ),
      { numRuns: 25 }
    );
  });
});

// Property 4: Escrow release only when goal is met
// Feature: stellar-soroban-smart-contracts, Property 4
describe('PBT — Property 4: Escrow release only when goal is met', () => {
  test('release throws iff balance < goalAmount', () => {
    // Validates: Requirements 5.3, 5.4, 5.5
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 500 }),
        fc.integer({ min: 0, max: 750 }),
        (goal, depositTotal) => {
          const c = new EscrowContract(goal);
          if (depositTotal > 0) c.deposit('donor', depositTotal);
          if (depositTotal < goal) {
            expect(() => c.release('recipient')).toThrow('Goal not yet reached');
          } else {
            const result = c.release('recipient');
            expect(result.amount).toBe(depositTotal);
            expect(result.recipientId).toBe('recipient');
          }
        }
      ),
      { numRuns: 25 }
    );
  });
});

// Property 1: Contract event storage round-trip
// Feature: stellar-soroban-smart-contracts, Property 1
describe('PBT — Property 1: Contract event storage round-trip', () => {
  test('getContractEvents returns exactly the events for that contractId', async () => {
    // Validates: Requirements 3.1, 3.2, 3.3
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 5 }),
        async (contractA, contractB, n) => {
          fc.pre(contractA !== contractB);
          const svc = new MockStellarService();
          for (let i = 0; i < n; i++) {
            await svc.invokeContract(contractA, 'deposit', [`d${i}`, i + 1]);
          }
          const eventsA = await svc.getContractEvents(contractA);
          const eventsB = await svc.getContractEvents(contractB);
          expect(eventsA).toHaveLength(n);
          expect(eventsB).toHaveLength(0);
          eventsA.forEach(e => expect(e.contractId).toBe(contractA));
        }
      ),
      { numRuns: 25 }
    );
  });
});

// Property 2: Event limit is respected
// Feature: stellar-soroban-smart-contracts, Property 2
describe('PBT — Property 2: Event limit is respected', () => {
  test('getContractEvents returns at most min(N, limit) events', async () => {
    // Validates: Requirements 3.4
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 15 }),
        async (n, limit) => {
          const svc = new MockStellarService();
          for (let i = 0; i < n; i++) {
            await svc.invokeContract('C001', 'deposit', [`d${i}`, i + 1]);
          }
          const events = await svc.getContractEvents('C001', limit);
          expect(events.length).toBeLessThanOrEqual(Math.min(n, limit));
        }
      ),
      { numRuns: 25 }
    );
  });
});

// Property 6: Validation error consistency
// Feature: stellar-soroban-smart-contracts, Property 6
describe('PBT — Property 6: Validation error consistency', () => {
  test('missing/empty contractId throws consistently in both services', async () => {
    // Validates: Requirements 2.4, 6.7
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.constant(''), fc.constant(null), fc.constant(undefined)),
        async (badId) => {
          const mock = new MockStellarService();
          const real = new StellarService();
          await expect(mock.invokeContract(badId, 'deposit', [])).rejects.toThrow('contractId is required');
          await expect(real.invokeContract(badId, 'deposit', [])).rejects.toThrow('contractId is required');
          await expect(mock.getContractEvents(badId)).rejects.toThrow('contractId is required');
          await expect(real.getContractEvents(badId)).rejects.toThrow('contractId is required');
        }
      ),
      { numRuns: 10 }
    );
  });
});

// Property 5: Mock deposit/release round-trip
// Feature: stellar-soroban-smart-contracts, Property 5
describe('PBT — Property 5: Mock deposit/release round-trip', () => {
  test('deposits meeting goal followed by release returns success and retrievable events', async () => {
    // Validates: Requirements 6.2, 6.3, 6.4, 6.6
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 5 }),
        async (goal, numDeposits) => {
          const svc = new MockStellarService();
          const perDeposit = Math.ceil(goal / numDeposits);
          for (let i = 0; i < numDeposits; i++) {
            await svc.invokeContract('C001', 'deposit', [`d${i}`, perDeposit]);
          }
          const releaseResult = await svc.invokeContract('C001', 'release', ['recipient', goal]);
          expect(releaseResult.status).toBe('success');
          const events = await svc.getContractEvents('C001');
          const releaseEvents = events.filter(e => e.type === 'release');
          expect(releaseEvents.length).toBeGreaterThanOrEqual(1);
        }
      ),
      { numRuns: 20 }
    );
  });
});
