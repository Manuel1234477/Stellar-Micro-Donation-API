'use strict';

const { createTokenBucket } = require('../../src/utils/tokenBucket');

describe('createTokenBucket', () => {
  let now;
  const clock = () => now;

  beforeEach(() => { now = 1000; });

  test('allows a burst up to the configured rate, then refuses', () => {
    const bucket = createTokenBucket(5, clock);
    for (let i = 0; i < 5; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  test('refills continuously at the configured rate', () => {
    const bucket = createTokenBucket(5, clock);
    for (let i = 0; i < 5; i++) bucket.take();
    now += 200; // 0.2s at 5/s = 1 token
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });

  test('never accumulates more than the burst capacity', () => {
    const bucket = createTokenBucket(3, clock);
    now += 60_000;
    for (let i = 0; i < 3; i++) expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
  });
});
