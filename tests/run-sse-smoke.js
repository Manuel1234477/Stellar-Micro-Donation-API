// Smoke test for SseManager — runs without jest to verify logic
const SseManager = require('../src/services/SseManager');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log('  ✓', name); passed++; }
  catch(e) { console.log('  ✗', name, '-', e.message); failed++; }
}

function mockRes() {
  const ls = {};
  const calls = [];
  return {
    calls,
    write: (c) => { calls.push(c); return true; },
    on: (e, cb) => { ls[e] = cb; },
    emit: (e) => { if (ls[e]) ls[e](); },
  };
}

function fresh() {
  // Reset singleton state
  SseManager._clients = new Map();
  SseManager._heartbeatTimer = null;
}

console.log('SseManager smoke tests:');

fresh();
test('addClient returns added:true', () => {
  const r = mockRes();
  const res = SseManager.addClient('k1', r, {});
  if (!res.added) throw new Error('added should be true');
  if (res.limitExceeded) throw new Error('limitExceeded should be false');
  if (SseManager.connectionCountForKey('k1') !== 1) throw new Error('count should be 1');
});

fresh();
test('enforces max 5 connections per key', () => {
  for (let i = 0; i < 5; i++) SseManager.addClient('k1', mockRes(), {});
  const r = SseManager.addClient('k1', mockRes(), {});
  if (!r.limitExceeded) throw new Error('should be limitExceeded');
  if (r.added) throw new Error('added should be false');
  if (SseManager.connectionCountForKey('k1') !== 5) throw new Error('count should stay 5');
});

fresh();
test('different keys have independent limits', () => {
  for (let i = 0; i < 5; i++) SseManager.addClient('A', mockRes(), {});
  const r = SseManager.addClient('B', mockRes(), {});
  if (!r.added) throw new Error('B should be added');
});

fresh();
test('close event removes client', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, {});
  r.emit('close');
  if (SseManager.connectionCountForKey('k1') !== 0) throw new Error('should be 0 after close');
});

fresh();
test('connectionCount totals all keys', () => {
  SseManager.addClient('k1', mockRes(), {});
  SseManager.addClient('k1', mockRes(), {});
  SseManager.addClient('k2', mockRes(), {});
  if (SseManager.connectionCount !== 3) throw new Error('expected 3');
});

fresh();
test('broadcast sends to all unfiltered clients', () => {
  const r1 = mockRes(), r2 = mockRes();
  SseManager.addClient('k1', r1, {});
  SseManager.addClient('k2', r2, {});
  SseManager.broadcastTransaction({ id: '1', donor: 'a', recipient: 'b', amount: 1 });
  if (r1.calls.length !== 1) throw new Error('r1 should receive');
  if (r2.calls.length !== 1) throw new Error('r2 should receive');
});

fresh();
test('broadcast event has correct structure', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, {});
  SseManager.broadcastTransaction({ id: '1', donor: 'a', recipient: 'b' });
  const raw = r.calls[0];
  if (!raw.startsWith('data: ')) throw new Error('should start with data:');
  const p = JSON.parse(raw.replace('data: ', '').trim());
  if (p.type !== 'transaction.confirmed') throw new Error('wrong type');
  if (p.data.id !== '1') throw new Error('wrong data');
});

fresh();
test('filter walletAddress — donor match', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, { walletAddress: 'alice' });
  SseManager.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob' });
  if (r.calls.length !== 1) throw new Error('should receive');
});

fresh();
test('filter walletAddress — recipient match', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, { walletAddress: 'bob' });
  SseManager.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob' });
  if (r.calls.length !== 1) throw new Error('should receive');
});

fresh();
test('filter walletAddress — no match skips', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, { walletAddress: 'charlie' });
  SseManager.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob' });
  if (r.calls.length !== 0) throw new Error('should not receive');
});

fresh();
test('filter campaignId — match', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, { campaignId: 'A' });
  SseManager.broadcastTransaction({ id: '1', donor: 'x', recipient: 'y', campaignId: 'A' });
  if (r.calls.length !== 1) throw new Error('should receive');
});

fresh();
test('filter campaignId — no match', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, { campaignId: 'A' });
  SseManager.broadcastTransaction({ id: '1', donor: 'x', recipient: 'y', campaignId: 'B' });
  if (r.calls.length !== 0) throw new Error('should not receive');
});

fresh();
test('both filters must match', () => {
  const r = mockRes();
  SseManager.addClient('k1', r, { walletAddress: 'alice', campaignId: 'A' });
  SseManager.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'b', campaignId: 'B' });
  if (r.calls.length !== 0) throw new Error('wrong campaign should not match');
  SseManager.broadcastTransaction({ id: '2', donor: 'alice', recipient: 'b', campaignId: 'A' });
  if (r.calls.length !== 1) throw new Error('both match should deliver');
});

fresh();
test('heartbeat sends ping to all clients', () => {
  const r1 = mockRes(), r2 = mockRes();
  SseManager.addClient('k1', r1, {});
  SseManager.addClient('k2', r2, {});
  SseManager._sendHeartbeat();
  if (r1.calls[0] !== ': ping\n\n') throw new Error('r1 wrong heartbeat');
  if (r2.calls[0] !== ': ping\n\n') throw new Error('r2 wrong heartbeat');
});

fresh();
test('start sets timer, stop clears it', () => {
  SseManager.start();
  if (!SseManager._heartbeatTimer) throw new Error('timer should be set');
  SseManager.stop();
  if (SseManager._heartbeatTimer !== null) throw new Error('timer should be null');
});

fresh();
test('start is idempotent', () => {
  SseManager.start();
  const t = SseManager._heartbeatTimer;
  SseManager.start();
  if (SseManager._heartbeatTimer !== t) throw new Error('timer should not change');
  SseManager.stop();
});

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
