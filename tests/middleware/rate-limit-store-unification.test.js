'use strict';

/**
 * Rate limit store unification (#1777)
 *
 * Covers:
 *  - middleware/RateLimitStore.js is gone; services/rateLimitStores is the only store
 *  - perKeyRateLimit and the express-rate-limit adapter share the same backend
 *  - Store errors are logged and follow fail-open / fail-closed
 *  - rateLimitHeaders.js does not import perKeyRateLimit.js (no cycle)
 */

const fs = require('fs');
const path = require('path');

const stores = require('../../src/services/rateLimitStores');
const { MemoryRateLimitStore, ExpressRateLimitStore, RateLimitStore } = stores;

const SRC = path.join(__dirname, '../../src');

afterEach(() => {
  stores.resetStore();
});

describe('single store abstraction', () => {
  it('the middleware store module was removed', () => {
    expect(fs.existsSync(path.join(SRC, 'middleware/RateLimitStore.js'))).toBe(false);
  });

  it('getRateLimitStore returns one shared instance', () => {
    expect(stores.getRateLimitStore()).toBe(stores.getRateLimitStore());
    expect(stores.getRateLimitStore()).toBeInstanceOf(RateLimitStore);
  });

  it('perKeyRateLimit counts in the shared store', () => {
    const shared = new MemoryRateLimitStore();
    stores.resetStore(shared);
    const { checkRateLimit } = require('../../src/middleware/perKeyRateLimit');
    checkRateLimit('shared-key', 5, 60);
    expect([...shared.windows.keys()].some(k => k.endsWith('shared-key'))).toBe(true);
  });

  it('ExpressRateLimitStore counts in the shared store with its own prefix', async () => {
    const shared = new MemoryRateLimitStore();
    stores.resetStore(shared);
    const a = new ExpressRateLimitStore({ prefix: 'a' });
    const b = new ExpressRateLimitStore({ prefix: 'b' });
    a.init({ windowMs: 60000 });
    b.init({ windowMs: 60000 });

    await a.increment('1.2.3.4');
    const second = await a.increment('1.2.3.4');
    const other = await b.increment('1.2.3.4');

    expect(second.totalHits).toBe(2);
    expect(other.totalHits).toBe(1);
    expect(second.resetTime).toBeInstanceOf(Date);
    expect(shared.windows.size).toBe(2);
  });

  it('memory store uses a fixed window that later hits do not extend', () => {
    const store = new MemoryRateLimitStore();
    const first = store.hit('k', 1000);
    const second = store.hit('k', 1000);
    expect(second.resetAt).toBe(first.resetAt);
    expect(second.count).toBe(2);
  });
});

describe('store failure policy', () => {
  class BrokenStore extends RateLimitStore {
    hit() { return Promise.reject(new Error('boom')); }
  }

  it('fails open and logs', async () => {
    const log = require('../../src/utils/log');
    const spy = jest.spyOn(log, 'error').mockImplementation(() => {});
    const result = await new BrokenStore({ failOpen: true }).incrementAndCheck('k', 5, 60);
    expect(result.allowed).toBe(true);
    expect(result.storeError).toBe(true);
    expect(spy).toHaveBeenCalledWith('RATE_LIMIT_STORE', expect.any(String), expect.objectContaining({ policy: 'fail-open' }));
    spy.mockRestore();
  });

  it('fails closed and logs', async () => {
    const log = require('../../src/utils/log');
    const spy = jest.spyOn(log, 'error').mockImplementation(() => {});
    const result = await new BrokenStore({ failOpen: false }).incrementAndCheck('k', 5, 60);
    expect(result.allowed).toBe(false);
    expect(spy).toHaveBeenCalledWith('RATE_LIMIT_STORE', expect.any(String), expect.objectContaining({ policy: 'fail-closed' }));
    spy.mockRestore();
  });

  it('express adapter reports over-limit when failing closed', async () => {
    const log = require('../../src/utils/log');
    const spy = jest.spyOn(log, 'error').mockImplementation(() => {});
    stores.resetStore(new BrokenStore({ failOpen: false }));
    const adapter = new ExpressRateLimitStore({ prefix: 'closed' });
    const { totalHits } = await adapter.increment('x');
    expect(totalHits).toBe(Number.MAX_SAFE_INTEGER);
    spy.mockRestore();
  });
});

describe('no circular dependency', () => {
  it('rateLimitHeaders.js does not require perKeyRateLimit.js', () => {
    const src = fs.readFileSync(path.join(SRC, 'middleware/rateLimitHeaders.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]\.\/perKeyRateLimit['"]\)/);
  });

  it('no source file requires the removed middleware store', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && /middleware\/RateLimitStore'|\.\/RateLimitStore'\)/.test(fs.readFileSync(full, 'utf8'))
          && !full.includes('rateLimitStores')) {
          offenders.push(full);
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
