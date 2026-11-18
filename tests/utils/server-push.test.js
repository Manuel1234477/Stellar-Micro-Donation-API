'use strict';

/**
 * Tests for src/utils/pushHelper.js  (Issue #405)
 *
 * Covers:
 *  - shouldPush() toggle via ENABLE_SERVER_PUSH env var and X-No-Push header
 *  - setLinkHeader() output format
 *  - pushResources() — HTTP/2 push + graceful degradation
 *  - pushDonationRelated() — full integration of the above
 */

const {
  shouldPush,
  setLinkHeader,
  pushResources,
  pushDonationRelated,
} = require('../../src/utils/pushHelper');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeReq(headers = {}) {
  return { headers };
}

function makeRes() {
  const headers = {};
  return {
    _headers: headers,
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
  };
}

function makeResWithPush() {
  const res = makeRes();
  res._pushed = [];
  res.push = jest.fn((url, opts, cb) => {
    res._pushed.push(url);
    const stream = { end: jest.fn() };
    cb(null, stream);
  });
  return res;
}

// ── shouldPush ────────────────────────────────────────────────────────────────

describe('shouldPush', () => {
  afterEach(() => { delete process.env.ENABLE_SERVER_PUSH; });

  it('returns false when ENABLE_SERVER_PUSH is not set', () => {
    delete process.env.ENABLE_SERVER_PUSH;
    // Re-require to pick up env change
    jest.resetModules();
    const { shouldPush: sp } = require('../../src/utils/pushHelper');
    expect(sp(makeReq())).toBe(false);
  });

  it('returns false when ENABLE_SERVER_PUSH=false', () => {
    process.env.ENABLE_SERVER_PUSH = 'false';
    jest.resetModules();
    const { shouldPush: sp } = require('../../src/utils/pushHelper');
    expect(sp(makeReq())).toBe(false);
  });

  it('returns true when ENABLE_SERVER_PUSH=true and no opt-out header', () => {
    process.env.ENABLE_SERVER_PUSH = 'true';
    jest.resetModules();
    const { shouldPush: sp } = require('../../src/utils/pushHelper');
    expect(sp(makeReq())).toBe(true);
  });

  it('returns false when X-No-Push: 1 is present even if push is enabled', () => {
    process.env.ENABLE_SERVER_PUSH = 'true';
    jest.resetModules();
    const { shouldPush: sp } = require('../../src/utils/pushHelper');
    expect(sp(makeReq({ 'x-no-push': '1' }))).toBe(false);
  });

  it('returns true when X-No-Push is 0 (not opted out)', () => {
    process.env.ENABLE_SERVER_PUSH = 'true';
    jest.resetModules();
    const { shouldPush: sp } = require('../../src/utils/pushHelper');
    expect(sp(makeReq({ 'x-no-push': '0' }))).toBe(true);
  });
});

// ── setLinkHeader ─────────────────────────────────────────────────────────────

describe('setLinkHeader', () => {
  it('sets a Link header with preload entries', () => {
    const res = makeRes();
    setLinkHeader(res, ['/wallets/1', '/transactions?donationId=2']);
    expect(res._headers['Link']).toBe(
      '</wallets/1>; rel=preload; as=fetch, </transactions?donationId=2>; rel=preload; as=fetch'
    );
  });

  it('does nothing when urls array is empty', () => {
    const res = makeRes();
    setLinkHeader(res, []);
    expect(res._headers['Link']).toBeUndefined();
  });

  it('handles a single URL', () => {
    const res = makeRes();
    setLinkHeader(res, ['/wallets/5']);
    expect(res._headers['Link']).toBe('</wallets/5>; rel=preload; as=fetch');
  });
});

// ── pushResources ─────────────────────────────────────────────────────────────

describe('pushResources', () => {
  it('calls res.push for each URL when available', () => {
    const req = makeReq({ authorization: 'Bearer tok' });
    const res = makeResWithPush();
    pushResources(req, res, ['/wallets/1', '/wallets/2']);
    expect(res.push).toHaveBeenCalledTimes(2);
    expect(res._pushed).toEqual(['/wallets/1', '/wallets/2']);
  });

  it('forwards Authorization header to pushed streams', () => {
    const req = makeReq({ authorization: 'Bearer secret' });
    const res = makeResWithPush();
    pushResources(req, res, ['/wallets/1']);
    const callOpts = res.push.mock.calls[0][1];
    expect(callOpts.request['authorization']).toBe('Bearer secret');
  });

  it('does not set authorization when header is absent', () => {
    const req = makeReq({});
    const res = makeResWithPush();
    pushResources(req, res, ['/wallets/1']);
    const callOpts = res.push.mock.calls[0][1];
    expect(callOpts.request['authorization']).toBeUndefined();
  });

  it('gracefully degrades when res.push is not a function (HTTP/1.1)', () => {
    const req = makeReq();
    const res = makeRes(); // no .push method
    expect(() => pushResources(req, res, ['/wallets/1'])).not.toThrow();
  });

  it('silently ignores push errors', () => {
    const req = makeReq();
    const res = makeRes();
    res.push = jest.fn((_url, _opts, cb) => cb(new Error('push failed'), null));
    expect(() => pushResources(req, res, ['/wallets/1'])).not.toThrow();
  });
});

// ── pushDonationRelated ───────────────────────────────────────────────────────

describe('pushDonationRelated', () => {
  beforeEach(() => {
    process.env.ENABLE_SERVER_PUSH = 'true';
    jest.resetModules();
  });
  afterEach(() => { delete process.env.ENABLE_SERVER_PUSH; });

  it('sets Link header with sender wallet, receiver wallet, and transactions', () => {
    const { pushDonationRelated: pdr } = require('../../src/utils/pushHelper');
    const req = makeReq();
    const res = makeRes();
    pdr(req, res, { id: 7, senderId: 1, receiverId: 2 });
    expect(res._headers['Link']).toContain('</wallets/1>');
    expect(res._headers['Link']).toContain('</wallets/2>');
    expect(res._headers['Link']).toContain('</transactions?donationId=7>');
  });

  it('skips when X-No-Push: 1', () => {
    const { pushDonationRelated: pdr } = require('../../src/utils/pushHelper');
    const req = makeReq({ 'x-no-push': '1' });
    const res = makeRes();
    pdr(req, res, { id: 7, senderId: 1, receiverId: 2 });
    expect(res._headers['Link']).toBeUndefined();
  });

  it('skips when donation is null', () => {
    const { pushDonationRelated: pdr } = require('../../src/utils/pushHelper');
    const req = makeReq();
    const res = makeRes();
    expect(() => pdr(req, res, null)).not.toThrow();
    expect(res._headers['Link']).toBeUndefined();
  });

  it('skips when ENABLE_SERVER_PUSH is not true', () => {
    delete process.env.ENABLE_SERVER_PUSH;
    jest.resetModules();
    const { pushDonationRelated: pdr } = require('../../src/utils/pushHelper');
    const req = makeReq();
    const res = makeRes();
    pdr(req, res, { id: 1, senderId: 1, receiverId: 2 });
    expect(res._headers['Link']).toBeUndefined();
  });

  it('omits missing fields gracefully', () => {
    const { pushDonationRelated: pdr } = require('../../src/utils/pushHelper');
    const req = makeReq();
    const res = makeRes();
    pdr(req, res, { id: 3 }); // no senderId / receiverId
    expect(res._headers['Link']).toBe('</transactions?donationId=3>; rel=preload; as=fetch');
  });

  it('initiates HTTP/2 push when res.push is available', () => {
    const { pushDonationRelated: pdr } = require('../../src/utils/pushHelper');
    const req = makeReq();
    const res = makeResWithPush();
    pdr(req, res, { id: 5, senderId: 10, receiverId: 20 });
    expect(res.push).toHaveBeenCalledTimes(3);
  });
});
