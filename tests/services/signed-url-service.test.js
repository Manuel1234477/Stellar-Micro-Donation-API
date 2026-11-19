/**
 * SignedUrlService tests (#1950)
 *
 * One signing implementation for all export downloads. Signatures must be
 * bound to the resource, the principal and the expiry, and must survive
 * secret rotation via EXPORT_SIGNING_SECRET_PREVIOUS.
 */

'use strict';

const SignedUrlService = require('../../src/services/SignedUrlService');

const NOW = 1_700_000_000_000;
const RESOURCE = 'export';
const ID = 'export-123';
const OWNER = 'key-owner';

describe('SignedUrlService (#1950)', () => {
  const savedEnv = {};
  const ENV_KEYS = ['EXPORT_SIGNING_SECRET', 'EXPORT_SIGNING_SECRET_PREVIOUS'];

  beforeEach(() => {
    ENV_KEYS.forEach((k) => { savedEnv[k] = process.env[k]; });
    process.env.EXPORT_SIGNING_SECRET = 'current-secret-for-tests-0123456789';
    delete process.env.EXPORT_SIGNING_SECRET_PREVIOUS;
  });

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  const signFor = (overrides = {}) => SignedUrlService.sign({
    resource: RESOURCE,
    resourceId: ID,
    principalId: OWNER,
    now: NOW,
    ...overrides,
  });

  test('a freshly signed link verifies for the owner before it expires', () => {
    const signed = signFor();
    expect(SignedUrlService.verify({
      resource: RESOURCE,
      resourceId: ID,
      principalId: OWNER,
      expires: signed.expires,
      signature: signed.signature,
      now: NOW + 1000,
    })).toBe(true);
  });

  test('expiry defaults to one hour and is returned in epoch ms and ISO form', () => {
    const signed = signFor();
    expect(Number(signed.expires)).toBe(NOW + SignedUrlService.DEFAULT_TTL_MS);
    expect(signed.expiresAt).toBe(new Date(NOW + SignedUrlService.DEFAULT_TTL_MS).toISOString());
  });

  test('rejects a link once it has expired', () => {
    const signed = signFor();
    expect(SignedUrlService.verify({
      resource: RESOURCE,
      resourceId: ID,
      principalId: OWNER,
      expires: signed.expires,
      signature: signed.signature,
      now: NOW + SignedUrlService.DEFAULT_TTL_MS,
    })).toBe(false);
  });

  test('rejects a link presented by a different principal', () => {
    const signed = signFor();
    expect(SignedUrlService.verify({
      resource: RESOURCE,
      resourceId: ID,
      principalId: 'someone-else',
      expires: signed.expires,
      signature: signed.signature,
      now: NOW + 1000,
    })).toBe(false);
  });

  test('rejects a signature issued for another resource or export id', () => {
    const signed = signFor();
    const base = { principalId: OWNER, expires: signed.expires, signature: signed.signature, now: NOW + 1000 };
    expect(SignedUrlService.verify({ ...base, resource: 'audit-export', resourceId: ID })).toBe(false);
    expect(SignedUrlService.verify({ ...base, resource: RESOURCE, resourceId: 'export-999' })).toBe(false);
  });

  test('rejects a tampered expiry', () => {
    const signed = signFor();
    expect(SignedUrlService.verify({
      resource: RESOURCE,
      resourceId: ID,
      principalId: OWNER,
      expires: String(Number(signed.expires) + 60_000),
      signature: signed.signature,
      now: NOW + 1000,
    })).toBe(false);
  });

  test('rejects malformed signatures without throwing', () => {
    const base = { resource: RESOURCE, resourceId: ID, principalId: OWNER, expires: String(NOW + 60_000), now: NOW };
    expect(SignedUrlService.verify({ ...base, signature: 'abc' })).toBe(false);
    expect(SignedUrlService.verify({ ...base, signature: 'z'.repeat(64) })).toBe(false);
    expect(SignedUrlService.verify({ ...base, signature: undefined })).toBe(false);
  });

  test('refuses to sign without a principal', () => {
    expect(() => SignedUrlService.sign({ resource: RESOURCE, resourceId: ID, principalId: '' }))
      .toThrow(/principalId/);
  });

  test('a link signed with the previous secret still verifies during rotation', () => {
    process.env.EXPORT_SIGNING_SECRET = 'old-secret-for-tests-0123456789abcd';
    const signed = signFor();

    process.env.EXPORT_SIGNING_SECRET = 'new-secret-for-tests-0123456789abcd';
    process.env.EXPORT_SIGNING_SECRET_PREVIOUS = 'old-secret-for-tests-0123456789abcd';
    const check = { resource: RESOURCE, resourceId: ID, principalId: OWNER, expires: signed.expires, signature: signed.signature, now: NOW + 1000 };
    expect(SignedUrlService.verify(check)).toBe(true);

    delete process.env.EXPORT_SIGNING_SECRET_PREVIOUS;
    expect(SignedUrlService.verify(check)).toBe(false);
  });

  test('new signatures use the current secret, not the previous one', () => {
    process.env.EXPORT_SIGNING_SECRET = 'new-secret-for-tests-0123456789abcd';
    process.env.EXPORT_SIGNING_SECRET_PREVIOUS = 'old-secret-for-tests-0123456789abcd';
    const signed = signFor();

    process.env.EXPORT_SIGNING_SECRET = 'old-secret-for-tests-0123456789abcd';
    process.env.EXPORT_SIGNING_SECRET_PREVIOUS = '';
    expect(SignedUrlService.verify({
      resource: RESOURCE, resourceId: ID, principalId: OWNER,
      expires: signed.expires, signature: signed.signature, now: NOW + 1000,
    })).toBe(false);
  });

  test('toQueryString emits expires and signature parameters', () => {
    const signed = signFor();
    const qs = SignedUrlService.toQueryString(signed);
    expect(qs).toBe(`expires=${encodeURIComponent(signed.expires)}&signature=${signed.signature}`);
  });
});
