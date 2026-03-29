'use strict';

const { verifySignature } = require('../../sdk/js/webhookVerifier');
const vectors = require('../../sdk/test-vectors/vectors.json');

describe('webhookVerifier', () => {
  // ── Test-vector parity ──────────────────────────────────────────────────
  describe('shared test vectors', () => {
    vectors.vectors.forEach(({ description, payload, secret, expected_signature }) => {
      it(`validates: ${description}`, () => {
        expect(verifySignature(payload, expected_signature, secret)).toBe(true);
      });
    });
  });

  // ── Valid signature ─────────────────────────────────────────────────────
  it('returns true for a correct signature', () => {
    const { vectors: [v] } = vectors;
    expect(verifySignature(v.payload, v.expected_signature, v.secret)).toBe(true);
  });

  // ── Tampered payload ────────────────────────────────────────────────────
  it('returns false when payload is tampered', () => {
    const { vectors: [v] } = vectors;
    expect(verifySignature(v.payload + ' tampered', v.expected_signature, v.secret)).toBe(false);
  });

  // ── Wrong secret ────────────────────────────────────────────────────────
  it('returns false for an incorrect secret', () => {
    const { vectors: [v] } = vectors;
    expect(verifySignature(v.payload, v.expected_signature, 'wrong-secret')).toBe(false);
  });

  // ── Wrong signature ─────────────────────────────────────────────────────
  it('returns false for a completely wrong signature', () => {
    expect(verifySignature('hello world', 'deadbeef'.repeat(8), 'my-secret-key')).toBe(false);
  });

  // ── Mismatched length (not valid hex of same length) ────────────────────
  it('returns false when signature has wrong length', () => {
    expect(verifySignature('hello', 'abc123', 'secret')).toBe(false);
  });

  // ── Buffer payload ──────────────────────────────────────────────────────
  it('accepts a Buffer payload', () => {
    const { vectors: [v] } = vectors;
    expect(verifySignature(Buffer.from(v.payload), v.expected_signature, v.secret)).toBe(true);
  });

  // ── Type guards ─────────────────────────────────────────────────────────
  it('returns false when signature is not a string', () => {
    expect(verifySignature('payload', null, 'secret')).toBe(false);
  });

  it('returns false when secret is not a string', () => {
    expect(verifySignature('payload', 'abc', null)).toBe(false);
  });

  // ── All test vectors return false with wrong secret ─────────────────────
  describe('all vectors fail with wrong secret', () => {
    vectors.vectors.forEach(({ description, payload, expected_signature }) => {
      it(`rejects tampered secret for: ${description}`, () => {
        expect(verifySignature(payload, expected_signature, 'wrong')).toBe(false);
      });
    });
  });
});
