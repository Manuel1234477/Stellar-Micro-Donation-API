'use strict';

/**
 * Tests: src/utils/timerRegistry.js
 *
 * Uses Jest fake timers so every test is fast and deterministic — no real
 * wall-clock time is consumed.  Each test that exercises the singleton flushes
 * it via clearAll() in beforeEach so tests are isolated from one another.
 */

// Mock the logger that timerRegistry imports so we don't get noisy output.
jest.mock('../../src/utils/log', () => ({
  info:  jest.fn(),
  warn:  jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Re-require a fresh singleton for each test file run (module cache is shared
// within a file, but we reset state via clearAll() in beforeEach).
const timerRegistry = require('../../src/utils/timerRegistry');
const { TimerRegistry } = require('../../src/utils/timerRegistry');

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
  // Reset the singleton so each test starts with an empty registry.
  timerRegistry.clearAll();
});

afterEach(() => {
  // Clean up any timers the test may have registered but not cleared.
  timerRegistry.clearAll();
  jest.useRealTimers();
});

// ─── createInterval ───────────────────────────────────────────────────────────

describe('timerRegistry.createInterval', () => {
  it('registers an interval that fires repeatedly', () => {
    const fn = jest.fn();
    timerRegistry.createInterval(fn, 1000, 'test-interval');

    jest.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns a handle with clear() and unref() methods', () => {
    const handle = timerRegistry.createInterval(() => {}, 500);
    expect(typeof handle.clear).toBe('function');
    expect(typeof handle.unref).toBe('function');
  });

  it('increments registry size after registration', () => {
    const before = timerRegistry.size;
    timerRegistry.createInterval(() => {}, 1000, 'size-check');
    expect(timerRegistry.size).toBe(before + 1);
  });

  it('clears the specific interval via handle.clear()', () => {
    const fn = jest.fn();
    const handle = timerRegistry.createInterval(fn, 1000, 'clearable');

    jest.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledTimes(1);

    handle.clear();

    jest.advanceTimersByTime(3000);
    // Should still be 1 — no more ticks after clear
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('removes the entry from the registry after handle.clear()', () => {
    const handle = timerRegistry.createInterval(() => {}, 1000, 'removed-on-clear');
    const before = timerRegistry.size;
    handle.clear();
    expect(timerRegistry.size).toBe(before - 1);
  });

  it('does not throw when handle.clear() is called twice (double-clear safety)', () => {
    const handle = timerRegistry.createInterval(() => {}, 1000, 'double-clear');
    handle.clear();
    expect(() => handle.clear()).not.toThrow();
  });

  it('does not throw when handle.unref() is called', () => {
    const handle = timerRegistry.createInterval(() => {}, 1000, 'unref-check');
    expect(() => handle.unref()).not.toThrow();
  });

  it('accepts a label-less interval', () => {
    const fn = jest.fn();
    timerRegistry.createInterval(fn, 500);
    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── createTimeout ────────────────────────────────────────────────────────────

describe('timerRegistry.createTimeout', () => {
  it('registers a timeout that fires once', () => {
    const fn = jest.fn();
    timerRegistry.createTimeout(fn, 2000, 'test-timeout');

    jest.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns a handle with clear() and unref() methods', () => {
    const handle = timerRegistry.createTimeout(() => {}, 500);
    expect(typeof handle.clear).toBe('function');
    expect(typeof handle.unref).toBe('function');
  });

  it('increments registry size after registration', () => {
    const before = timerRegistry.size;
    timerRegistry.createTimeout(() => {}, 1000, 'size-check-timeout');
    expect(timerRegistry.size).toBe(before + 1);
  });

  it('removes itself from the registry after firing', () => {
    const fn = jest.fn();
    timerRegistry.createTimeout(fn, 500, 'auto-removed');

    const before = timerRegistry.size;
    jest.advanceTimersByTime(500);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(timerRegistry.size).toBe(before - 1);
  });

  it('clears the specific timeout via handle.clear() before it fires', () => {
    const fn = jest.fn();
    const handle = timerRegistry.createTimeout(fn, 2000, 'clearable-timeout');

    handle.clear();
    jest.advanceTimersByTime(5000);

    expect(fn).not.toHaveBeenCalled();
  });

  it('removes the entry from the registry after handle.clear()', () => {
    const handle = timerRegistry.createTimeout(() => {}, 2000, 'removed-timeout');
    const before = timerRegistry.size;
    handle.clear();
    expect(timerRegistry.size).toBe(before - 1);
  });

  it('does not throw when handle.clear() is called twice (double-clear safety)', () => {
    const handle = timerRegistry.createTimeout(() => {}, 1000, 'double-clear-timeout');
    handle.clear();
    expect(() => handle.clear()).not.toThrow();
  });

  it('does not throw when handle.unref() is called', () => {
    const handle = timerRegistry.createTimeout(() => {}, 1000, 'unref-timeout');
    expect(() => handle.unref()).not.toThrow();
  });

  it('accepts a label-less timeout', () => {
    const fn = jest.fn();
    timerRegistry.createTimeout(fn, 500);
    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ─── clearAll ─────────────────────────────────────────────────────────────────

describe('timerRegistry.clearAll', () => {
  it('clears all registered intervals and timeouts', () => {
    const intervalFn = jest.fn();
    const timeoutFn  = jest.fn();

    timerRegistry.createInterval(intervalFn, 500, 'interval-to-clear');
    timerRegistry.createTimeout(timeoutFn, 1000, 'timeout-to-clear');

    timerRegistry.clearAll();

    jest.advanceTimersByTime(5000);

    expect(intervalFn).not.toHaveBeenCalled();
    expect(timeoutFn).not.toHaveBeenCalled();
  });

  it('sets registry size to 0 after clearAll()', () => {
    timerRegistry.createInterval(() => {}, 500);
    timerRegistry.createInterval(() => {}, 500);
    timerRegistry.createTimeout(() => {}, 1000);

    timerRegistry.clearAll();
    expect(timerRegistry.size).toBe(0);
  });

  it('clears multiple intervals independently', () => {
    const fns = [jest.fn(), jest.fn(), jest.fn()];
    fns.forEach((fn, i) => timerRegistry.createInterval(fn, (i + 1) * 500));

    timerRegistry.clearAll();
    jest.advanceTimersByTime(10000);

    fns.forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it('does not throw when called on an already-empty registry', () => {
    // clearAll() was called in beforeEach so the registry is empty here.
    expect(() => timerRegistry.clearAll()).not.toThrow();
  });

  it('does not throw when called twice in a row', () => {
    timerRegistry.createInterval(() => {}, 500);
    timerRegistry.clearAll();
    expect(() => timerRegistry.clearAll()).not.toThrow();
  });

  it('only clears timers registered before the call — new timers created after still fire', () => {
    const before = jest.fn();
    const after  = jest.fn();

    timerRegistry.createTimeout(before, 1000, 'before-clear');
    timerRegistry.clearAll();

    timerRegistry.createTimeout(after, 1000, 'after-clear');
    jest.advanceTimersByTime(1500);

    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

// ─── size property ────────────────────────────────────────────────────────────

describe('timerRegistry.size', () => {
  it('returns 0 on a freshly cleared registry', () => {
    expect(timerRegistry.size).toBe(0);
  });

  it('increments correctly as timers are added', () => {
    timerRegistry.createInterval(() => {}, 500);
    expect(timerRegistry.size).toBe(1);
    timerRegistry.createTimeout(() => {}, 1000);
    expect(timerRegistry.size).toBe(2);
  });

  it('decrements when a handle is explicitly cleared', () => {
    const h1 = timerRegistry.createInterval(() => {}, 500);
    timerRegistry.createInterval(() => {}, 500);
    h1.clear();
    expect(timerRegistry.size).toBe(1);
  });
});

// ─── TimerRegistry class (named export) ──────────────────────────────────────

describe('TimerRegistry (class, named export)', () => {
  it('is exported as the named TimerRegistry property', () => {
    expect(TimerRegistry).toBeDefined();
    expect(typeof TimerRegistry).toBe('function');
  });

  it('creates independent instances that do not share state', () => {
    const reg1 = new TimerRegistry();
    const reg2 = new TimerRegistry();

    reg1.createInterval(() => {}, 500, 'reg1-interval');

    expect(reg1.size).toBe(1);
    expect(reg2.size).toBe(0);

    reg1.clearAll();
  });

  it('singleton default export is an instance of TimerRegistry', () => {
    expect(timerRegistry).toBeInstanceOf(TimerRegistry);
  });
});
