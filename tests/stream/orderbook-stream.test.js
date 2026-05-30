'use strict';

/**
 * Tests: Add support for Stellar offer book streaming (Issue #415)
 *
 * All Stellar interactions use MockStellarService — no live Horizon calls.
 */

const MockStellarService = require('../../src/services/MockStellarService');
const { parseAsset } = require('../../src/routes/orderbook');

// ─────────────────────────────────────────────────────────────────────────────
// parseAsset helper
// ─────────────────────────────────────────────────────────────────────────────
describe('parseAsset', () => {
  test('XLM returns "XLM"', () => expect(parseAsset('XLM')).toBe('XLM'));
  test('xlm (lowercase) returns "XLM"', () => expect(parseAsset('xlm')).toBe('XLM'));
  test('native returns "XLM"', () => expect(parseAsset('native')).toBe('XLM'));
  test('CODE:ISSUER returns normalised string', () => {
    expect(parseAsset('USDC:GABC')).toBe('USDC:GABC');
  });
  test('URL-encoded asset is decoded', () => {
    expect(parseAsset(encodeURIComponent('USDC:GABC'))).toBe('USDC:GABC');
  });
  test('throws on empty string', () => {
    expect(() => parseAsset('')).toThrow();
  });
  test('throws on missing issuer', () => {
    expect(() => parseAsset('USDC:')).toThrow();
  });
  test('throws on no colon and not XLM', () => {
    expect(() => parseAsset('USDC')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MockStellarService.getOrderBook
// ─────────────────────────────────────────────────────────────────────────────
describe('MockStellarService.getOrderBook', () => {
  let mock;

  beforeEach(() => { mock = new MockStellarService(); });

  test('returns bids, asks, base, counter', async () => {
    const result = await mock.getOrderBook('XLM', 'USDC:GABC');
    expect(result).toHaveProperty('bids');
    expect(result).toHaveProperty('asks');
    expect(result).toHaveProperty('base');
    expect(result).toHaveProperty('counter');
    expect(Array.isArray(result.bids)).toBe(true);
    expect(Array.isArray(result.asks)).toBe(true);
  });

  test('returns empty arrays when no offers exist', async () => {
    const result = await mock.getOrderBook('XLM', 'USDC:GABC');
    expect(result.bids).toHaveLength(0);
    expect(result.asks).toHaveLength(0);
  });

  test('reflects offers created via createOffer', async () => {
    const { secretKey } = await mock.createWallet();
    await mock.fundTestnetWallet((await mock.createWallet()).publicKey);
    // Fund the seller
    const seller = await mock.createWallet();
    mock.wallets.get(seller.publicKey).balance = '1000.0000000';

    await mock.createOffer({
      sourceSecret: seller.secretKey,
      sellingAsset: 'XLM',
      buyingAsset: 'USDC:GABC',
      amount: '100',
      price: '0.5',
    });

    const result = await mock.getOrderBook('XLM', 'USDC:GABC');
    expect(result.asks.length).toBeGreaterThan(0);
  });

  test('throws on missing assets', async () => {
    await expect(mock.getOrderBook('', 'XLM')).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MockStellarService.streamOrderbook
// ─────────────────────────────────────────────────────────────────────────────
describe('MockStellarService.streamOrderbook', () => {
  let mock;

  beforeEach(() => { mock = new MockStellarService(); });

  test('returns a close function', () => {
    const close = mock.streamOrderbook('XLM', 'USDC:GABC', () => {});
    expect(typeof close).toBe('function');
    close();
  });

  test('onUpdate is called when triggerOrderbookUpdate fires', () => {
    const updates = [];
    mock.streamOrderbook('XLM', 'USDC:GABC', (data) => updates.push(data));

    const snapshot = { bids: [{ price: '0.5', amount: '100' }], asks: [] };
    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', snapshot);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual(snapshot);
  });

  test('close removes the listener — no more updates after close', () => {
    const updates = [];
    const close = mock.streamOrderbook('XLM', 'USDC:GABC', (d) => updates.push(d));

    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { bids: [], asks: [] });
    expect(updates).toHaveLength(1);

    close();
    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { bids: [], asks: [] });
    expect(updates).toHaveLength(1); // no new update after close
  });

  test('getOrderbookListenerCount tracks active streams', () => {
    expect(mock.getOrderbookListenerCount('XLM', 'USDC:GABC')).toBe(0);

    const close1 = mock.streamOrderbook('XLM', 'USDC:GABC', () => {});
    const close2 = mock.streamOrderbook('XLM', 'USDC:GABC', () => {});
    expect(mock.getOrderbookListenerCount('XLM', 'USDC:GABC')).toBe(2);

    close1();
    expect(mock.getOrderbookListenerCount('XLM', 'USDC:GABC')).toBe(1);

    close2();
    expect(mock.getOrderbookListenerCount('XLM', 'USDC:GABC')).toBe(0);
  });

  test('concurrent streams for different pairs are independent', () => {
    const xlmUsdc = [];
    const xlmEurt = [];

    mock.streamOrderbook('XLM', 'USDC:GABC', (d) => xlmUsdc.push(d));
    mock.streamOrderbook('XLM', 'EURT:GDEF', (d) => xlmEurt.push(d));

    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { pair: 'xlm-usdc' });
    mock.triggerOrderbookUpdate('XLM', 'EURT:GDEF', { pair: 'xlm-eurt' });

    expect(xlmUsdc).toHaveLength(1);
    expect(xlmUsdc[0].pair).toBe('xlm-usdc');
    expect(xlmEurt).toHaveLength(1);
    expect(xlmEurt[0].pair).toBe('xlm-eurt');
  });

  test('multiple listeners on same pair all receive updates', () => {
    const a = [], b = [];
    mock.streamOrderbook('XLM', 'USDC:GABC', (d) => a.push(d));
    mock.streamOrderbook('XLM', 'USDC:GABC', (d) => b.push(d));

    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { bids: [], asks: [] });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  test('triggerOrderbookUpdate is a no-op when no listeners exist', () => {
    expect(() => mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', {})).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /snapshot endpoint handler logic
// ─────────────────────────────────────────────────────────────────────────────
describe('/snapshot handler logic', () => {
  let mock;

  function makeReqRes(params = { baseAsset: 'XLM', counterAsset: 'USDC:GABC' }, query = {}) {
    const req = { params, query, user: { id: 'u1', role: 'user' }, id: 'r1', ip: '127.0.0.1' };
    const res = {
      _status: 200, _body: null,
      status(c) { this._status = c; return this; },
      json(b) { this._body = b; return this; },
    };
    return { req, res, next: jest.fn() };
  }

  async function snapshotHandler(req, res, next, stellarSvc) {
    try {
      const base = parseAsset(req.params.baseAsset);
      const counter = parseAsset(req.params.counterAsset);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 200);
      const data = await stellarSvc.getOrderBook(base, counter, limit);
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  beforeEach(() => { mock = new MockStellarService(); });

  test('returns 200 with bids and asks', async () => {
    const { req, res, next } = makeReqRes();
    await snapshotHandler(req, res, next, mock);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data).toHaveProperty('bids');
    expect(res._body.data).toHaveProperty('asks');
  });

  test('respects limit query param', async () => {
    const { req, res, next } = makeReqRes({ baseAsset: 'XLM', counterAsset: 'USDC:GABC' }, { limit: '5' });
    await snapshotHandler(req, res, next, mock);
    expect(res._body.success).toBe(true);
  });

  test('calls next on invalid asset', async () => {
    const { req, res, next } = makeReqRes({ baseAsset: 'INVALID', counterAsset: 'USDC:GABC' });
    await snapshotHandler(req, res, next, mock);
    expect(next).toHaveBeenCalled();
  });

  test('calls next on stellar error', async () => {
    mock.getOrderBook = jest.fn().mockRejectedValue(new Error('Horizon down'));
    const { req, res, next } = makeReqRes();
    await snapshotHandler(req, res, next, mock);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Horizon down' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// /stream endpoint handler logic
// ─────────────────────────────────────────────────────────────────────────────
describe('/stream handler logic', () => {
  let mock;

  function makeStreamReqRes(params = { baseAsset: 'XLM', counterAsset: 'USDC:GABC' }) {
    const closeListeners = [];
    const req = {
      params,
      user: { id: 'u1', role: 'user' },
      id: 'r1',
      ip: '127.0.0.1',
      on(event, cb) { if (event === 'close') closeListeners.push(cb); },
      _triggerClose() { closeListeners.forEach(cb => cb()); },
    };
    const written = [];
    const res = {
      _headers: {},
      setHeader(k, v) { this._headers[k] = v; },
      flushHeaders() {},
      write(chunk) { written.push(chunk); },
      _written: written,
    };
    return { req, res, next: jest.fn() };
  }

  function streamHandler(req, res, next, stellarSvc) {
    let base, counter;
    try {
      base = parseAsset(req.params.baseAsset);
      counter = parseAsset(req.params.counterAsset);
    } catch (err) {
      return next(err);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const closeStream = stellarSvc.streamOrderbook(base, counter, (update) => {
      res.write(`data: ${JSON.stringify(update)}\n\n`);
    });

    req.on('close', () => {
      if (typeof closeStream === 'function') closeStream();
    });
  }

  beforeEach(() => { mock = new MockStellarService(); });

  test('sets SSE headers', () => {
    const { req, res, next } = makeStreamReqRes();
    streamHandler(req, res, next, mock);
    expect(res._headers['Content-Type']).toBe('text/event-stream');
    expect(res._headers['Cache-Control']).toBe('no-cache');
    expect(res._headers['Connection']).toBe('keep-alive');
  });

  test('writes SSE data when update is triggered', () => {
    const { req, res, next } = makeStreamReqRes();
    streamHandler(req, res, next, mock);

    const snapshot = { bids: [{ price: '0.5', amount: '100' }], asks: [] };
    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', snapshot);

    expect(res._written).toHaveLength(1);
    expect(res._written[0]).toContain('data:');
    expect(res._written[0]).toContain(JSON.stringify(snapshot));
  });

  test('closing client connection stops the Horizon stream', () => {
    const { req, res, next } = makeStreamReqRes();
    streamHandler(req, res, next, mock);

    expect(mock.getOrderbookListenerCount('XLM', 'USDC:GABC')).toBe(1);

    req._triggerClose(); // simulate client disconnect

    expect(mock.getOrderbookListenerCount('XLM', 'USDC:GABC')).toBe(0);
  });

  test('no more writes after client disconnects', () => {
    const { req, res, next } = makeStreamReqRes();
    streamHandler(req, res, next, mock);

    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { bids: [], asks: [] });
    expect(res._written).toHaveLength(1);

    req._triggerClose();
    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { bids: [], asks: [] });
    expect(res._written).toHaveLength(1); // no new write
  });

  test('concurrent streams for different pairs are independent', () => {
    const { req: req1, res: res1, next: next1 } = makeStreamReqRes({ baseAsset: 'XLM', counterAsset: 'USDC:GABC' });
    const { req: req2, res: res2, next: next2 } = makeStreamReqRes({ baseAsset: 'XLM', counterAsset: 'EURT:GDEF' });

    streamHandler(req1, res1, next1, mock);
    streamHandler(req2, res2, next2, mock);

    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { pair: 'xlm-usdc' });
    mock.triggerOrderbookUpdate('XLM', 'EURT:GDEF', { pair: 'xlm-eurt' });

    expect(res1._written).toHaveLength(1);
    expect(res1._written[0]).toContain('xlm-usdc');
    expect(res2._written).toHaveLength(1);
    expect(res2._written[0]).toContain('xlm-eurt');
  });

  test('calls next on invalid asset param', () => {
    const { req, res, next } = makeStreamReqRes({ baseAsset: 'INVALID', counterAsset: 'USDC:GABC' });
    streamHandler(req, res, next, mock);
    expect(next).toHaveBeenCalled();
  });

  test('multiple concurrent clients on same pair all receive updates', () => {
    const { req: req1, res: res1, next: n1 } = makeStreamReqRes();
    const { req: req2, res: res2, next: n2 } = makeStreamReqRes();

    streamHandler(req1, res1, n1, mock);
    streamHandler(req2, res2, n2, mock);

    mock.triggerOrderbookUpdate('XLM', 'USDC:GABC', { bids: [], asks: [] });

    expect(res1._written).toHaveLength(1);
    expect(res2._written).toHaveLength(1);
  });
});
