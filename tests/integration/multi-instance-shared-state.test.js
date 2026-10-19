'use strict';

/**
 * Multi-instance shared state (#1786)
 *
 * Runs two independent app instances (separate module registries, as two pods
 * would have) against one shared store and checks that correctness-critical
 * state is visible to both: body-hash deduplication, request nonces and SSE
 * per-key connection limits.
 *
 * The shared store is a MemorySharedStateStore flagged as distributed, which
 * stands in for Redis without needing a server.
 */

const request = require('supertest');
const express = require('express');
const { EventEmitter } = require('events');
const { MemorySharedStateStore } = require('../../src/utils/sharedStateStore');

class FakeDistributedStore extends MemorySharedStateStore {
  get isDistributed() { return true; }
}

/** Load a fresh copy of a module tree, as a separate process would. */
function loadIsolated(sharedStore, loader) {
  let result;
  jest.isolateModules(() => {
    require('../../src/utils/sharedStateStore').setSharedStateStore(sharedStore);
    result = loader();
  });
  return result;
}

function buildApp(sharedStore, handlerCalls) {
  return loadIsolated(sharedStore, () => {
    const { createDeduplicationMiddleware } = require('../../src/middleware/deduplication');
    const app = express();
    app.use(express.json());
    app.use(createDeduplicationMiddleware({ ttlMs: 5000 }));
    app.post('/donations', (req, res) => {
      handlerCalls.count++;
      res.status(201).json({ id: handlerCalls.count, amount: req.body.amount });
    });
    return app;
  });
}

function fakeResponse() {
  const res = new EventEmitter();
  res.chunks = [];
  res.ended = false;
  res.write = (chunk) => { res.chunks.push(chunk); return true; };
  res.end = () => { res.ended = true; };
  return res;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('Shared state across two app instances (#1786)', () => {
  test('a retry against the other instance is deduplicated', async () => {
    const shared = new FakeDistributedStore();
    const calls = { count: 0 };
    const podA = buildApp(shared, calls);
    const podB = buildApp(shared, calls);

    const first = await request(podA)
      .post('/donations')
      .set('x-api-key', 'key-1')
      .send({ amount: '10', recipient: 'GABC' });
    expect(first.status).toBe(201);
    expect(first.headers['x-deduplicated']).toBeUndefined();

    // Response is stored asynchronously after it is sent.
    await flush();

    const retry = await request(podB)
      .post('/donations')
      .set('x-api-key', 'key-1')
      .send({ recipient: 'GABC', amount: '10' });
    expect(retry.status).toBe(201);
    expect(retry.headers['x-deduplicated']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(calls.count).toBe(1);
  });

  test('without a shared store each instance deduplicates only its own requests', async () => {
    const calls = { count: 0 };
    const podA = buildApp(null, calls);
    const podB = buildApp(null, calls);

    await request(podA).post('/donations').set('x-api-key', 'key-2').send({ amount: '5' });
    const retry = await request(podB).post('/donations').set('x-api-key', 'key-2').send({ amount: '5' });

    expect(retry.headers['x-deduplicated']).toBeUndefined();
    expect(calls.count).toBe(2);
  });

  test('a nonce used on one instance is rejected on the other', async () => {
    const shared = new FakeDistributedStore();
    const storeA = loadIsolated(shared, () => require('../../src/utils/nonceStore').initializeDefaultStore());
    const storeB = loadIsolated(shared, () => require('../../src/utils/nonceStore').initializeDefaultStore());

    try {
      const nonce = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      await expect(storeA.check(nonce)).resolves.toEqual({ seen: false });
      await expect(storeB.check(nonce)).resolves.toEqual({ seen: true });
    } finally {
      storeA.stopCleanup();
      storeB.stopCleanup();
    }
  });

  test('SSE per-key limit is enforced across instances', async () => {
    const shared = new FakeDistributedStore();
    const sseA = loadIsolated(shared, () => require('../../src/services/SseManager'));
    const sseB = loadIsolated(shared, () => require('../../src/services/SseManager'));
    const limit = sseA.MAX_CONNECTIONS_PER_KEY;

    try {
      const streams = [];
      for (let i = 0; i < limit; i++) {
        const mgr = i % 2 === 0 ? sseA : sseB;
        const res = fakeResponse();
        expect(mgr.addClient(`c${i}`, 'key-3', {}, res).added).toBe(true);
        streams.push(res);
        await flush();
      }
      expect(await shared.countMembers('sse:conn:key-3')).toBe(limit);
      streams.forEach((res) => expect(res.ended).toBe(false));

      // Both local managers are under the limit, so the connection is accepted
      // locally, then closed once the shared registration shows the overflow.
      const overflow = fakeResponse();
      expect(sseB.addClient('overflow', 'key-3', {}, overflow).added).toBe(true);
      await flush();

      expect(overflow.ended).toBe(true);
      expect(overflow.chunks.join('')).toContain('connection_limit_exceeded');
      expect(await shared.countMembers('sse:conn:key-3')).toBe(limit);

      // Closing a stream on one instance frees a slot for the other.
      sseA.removeClient('c0');
      await flush();
      const replacement = fakeResponse();
      expect(sseB.addClient('replacement', 'key-3', {}, replacement).added).toBe(true);
      await flush();
      expect(replacement.ended).toBe(false);
    } finally {
      sseA._reset();
      sseB._reset();
    }
  });
});
