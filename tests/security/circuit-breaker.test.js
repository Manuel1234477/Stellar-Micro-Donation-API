'use strict';

const { CircuitBreaker, STATES } = require('../../src/utils/circuitBreaker');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ok = () => Promise.resolve('ok');
const fail = (msg = 'horizon error') => () => Promise.reject(new Error(msg));

/**
 * Open the circuit by recording `threshold` failures in quick succession.
 */
async function openCircuit(cb) {
  for (let i = 0; i < cb.failureThreshold; i++) {
    await expect(cb.execute(fail())).rejects.toThrow();
  }
  expect(cb.state).toBe(STATES.OPEN);
}

// ─── State: CLOSED ────────────────────────────────────────────────────────────

describe('CircuitBreaker — CLOSED state', () => {
  test('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe(STATES.CLOSED);
  });

  test('passes through successful calls', async () => {
    const cb = new CircuitBreaker();
    await expect(cb.execute(ok)).resolves.toBe('ok');
  });

  test('re-throws errors without opening when below threshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5 });
    for (let i = 0; i < 4; i++) {
      await expect(cb.execute(fail())).rejects.toThrow('horizon error');
    }
    expect(cb.state).toBe(STATES.CLOSED);
  });

  test('opens after reaching failure threshold', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 5, windowMs: 60_000 });
    await openCircuit(cb);
  });

  test('failures outside the window do not count toward threshold', async () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 3, windowMs: 1_000 });

    // Record 2 failures
    for (let i = 0; i < 2; i++) {
      await expect(cb.execute(fail())).rejects.toThrow();
    }

    // Advance past the window so those failures expire
    jest.advanceTimersByTime(1_100);

    // One more failure — should NOT open (only 1 in window)
    await expect(cb.execute(fail())).rejects.toThrow();
    expect(cb.state).toBe(STATES.CLOSED);

    jest.useRealTimers();
  });
});

// ─── State: OPEN ─────────────────────────────────────────────────────────────

describe('CircuitBreaker — OPEN state', () => {
  test('returns 503 immediately without calling the operation', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    await openCircuit(cb);

    const spy = jest.fn(ok);
    const err = await cb.execute(spy).catch(e => e);

    expect(spy).not.toHaveBeenCalled();
    expect(err.status).toBe(503);
    expect(err.circuitOpen).toBe(true);
  });

  test('remains open before cooldown elapses', async () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
    await openCircuit(cb);

    jest.advanceTimersByTime(29_999);
    expect(cb.state).toBe(STATES.OPEN);

    jest.useRealTimers();
  });

  test('transitions to half-open after cooldown', async () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
    await openCircuit(cb);

    jest.advanceTimersByTime(30_000);
    // Trigger the transition check by calling execute (it will probe)
    cb._maybeTransitionToHalfOpen();
    expect(cb.state).toBe(STATES.HALF_OPEN);

    jest.useRealTimers();
  });
});

// ─── State: HALF_OPEN ────────────────────────────────────────────────────────

describe('CircuitBreaker — HALF_OPEN state', () => {
  /**
   * Helper: open the circuit then fast-forward past cooldown so the next
   * execute() call sees HALF_OPEN.
   */
  async function halfOpenCircuit(options = {}) {
    jest.useFakeTimers();
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000, ...options });
    await openCircuit(cb);
    jest.advanceTimersByTime(30_000);
    return cb;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  test('allows exactly one probe request', async () => {
    const cb = await halfOpenCircuit();
    const spy = jest.fn(ok);

    // First call — probe
    await cb.execute(spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('second concurrent caller gets 503 while probe is in-flight', async () => {
    const cb = await halfOpenCircuit();

    // Probe that never resolves (simulates slow Horizon)
    let resolveProbe;
    const slowOp = () => new Promise(res => { resolveProbe = res; });

    const probePromise = cb.execute(slowOp);

    // Second caller should be rejected immediately
    const err = await cb.execute(ok).catch(e => e);
    expect(err.status).toBe(503);
    expect(err.circuitOpen).toBe(true);

    // Clean up — resolve the probe
    resolveProbe('done');
    await probePromise;
  });

  test('successful probe closes the circuit', async () => {
    const cb = await halfOpenCircuit();
    await cb.execute(ok);
    expect(cb.state).toBe(STATES.CLOSED);
  });

  test('failed probe re-opens the circuit', async () => {
    const cb = await halfOpenCircuit();
    await expect(cb.execute(fail())).rejects.toThrow();
    expect(cb.state).toBe(STATES.OPEN);
  });

  test('circuit closed after probe resets failure count', async () => {
    const cb = await halfOpenCircuit({ failureThreshold: 3 });
    await cb.execute(ok); // probe succeeds → CLOSED
    expect(cb.getStatus().failures).toBe(0);
  });
});

// ─── getStatus ───────────────────────────────────────────────────────────────

describe('CircuitBreaker — getStatus()', () => {
  test('returns state, failures, and null openedAt when closed', () => {
    const cb = new CircuitBreaker();
    const s = cb.getStatus();
    expect(s.state).toBe(STATES.CLOSED);
    expect(s.failures).toBe(0);
    expect(s.openedAt).toBeNull();
  });

  test('returns ISO openedAt when open', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    await openCircuit(cb);
    const s = cb.getStatus();
    expect(s.state).toBe(STATES.OPEN);
    expect(typeof s.openedAt).toBe('string');
    expect(() => new Date(s.openedAt)).not.toThrow();
  });
});

// ─── Health check integration ─────────────────────────────────────────────────

describe('HealthCheckService — circuit breaker in stellar check', () => {
  const HealthCheckService = require('../../src/services/HealthCheckService');

  test('includes circuitBreaker field when stellarService exposes it', async () => {
    const mockStellarService = {
      getNetwork: () => 'testnet',
      getEnvironment: () => ({ name: 'testnet' }),
      getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      circuitBreaker: {
        getStatus: () => ({ state: 'closed', failures: 0, openedAt: null }),
      },
    };

    const result = await HealthCheckService.checkStellar(mockStellarService);
    expect(result.circuitBreaker).toEqual({ state: 'closed', failures: 0, openedAt: null });
  });

  test('circuitBreaker field is undefined when service has no circuit breaker', async () => {
    const mockStellarService = {
      getNetwork: () => 'testnet',
      getEnvironment: () => ({ name: 'testnet' }),
      getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
    };

    const result = await HealthCheckService.checkStellar(mockStellarService);
    expect(result.circuitBreaker).toBeUndefined();
  });
});
