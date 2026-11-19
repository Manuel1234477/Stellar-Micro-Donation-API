'use strict';

/**
 * Silent-catch guard (#1946). Covers what counts as silent and what is justified.
 */

const { findSilentCatches } = require('../../scripts/check-no-silent-catch.js');

describe('findSilentCatches', () => {
  test('flags an empty promise catch', () => {
    expect(findSilentCatches('audit.log(x).catch(() => {});')).toHaveLength(1);
  });

  test('flags an empty block catch', () => {
    expect(findSilentCatches('try { run(); } catch (_e) {}')).toHaveLength(1);
    expect(findSilentCatches('try { run(); } catch {}')).toHaveLength(1);
  });

  test('accepts a catch justified by a comment on the same line', () => {
    expect(findSilentCatches('try { x(); } catch (_) { /* metrics only */ }')).toHaveLength(0);
  });

  test('accepts a catch justified by a comment on the preceding line', () => {
    const src = '// Ignored: the caller already handles the failure\nfoo().catch(() => {});';
    expect(findSilentCatches(src)).toHaveLength(0);
  });

  test('accepts catches that route the error to a handler', () => {
    expect(findSilentCatches('audit.log(x).catch(bestEffort("site"));')).toHaveLength(0);
  });

  test('reports the 1-based line of each site', () => {
    const src = 'const a = 1;\nconst b = 2;\nfoo().catch(() => {});';
    expect(findSilentCatches(src)[0].line).toBe(3);
  });
});
