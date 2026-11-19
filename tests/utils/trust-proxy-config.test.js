/**
 * Trust-proxy configuration (#1954).
 *
 * Covers the TRUSTED_PROXIES parsing used for Express `trust proxy`, the
 * production startup warning when it is unset, and that the deploy manifests
 * set it.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_TRUST_PROXY,
  resolveTrustProxy,
  trustProxyStartupWarning,
} = require('../../src/utils/trustProxy');

const ROOT = path.join(__dirname, '..', '..');

describe('resolveTrustProxy', () => {
  test('defaults to loopback when TRUSTED_PROXIES is unset or empty', () => {
    expect(resolveTrustProxy(undefined)).toBe(DEFAULT_TRUST_PROXY);
    expect(resolveTrustProxy(null)).toBe(DEFAULT_TRUST_PROXY);
    expect(resolveTrustProxy('')).toBe(DEFAULT_TRUST_PROXY);
    expect(DEFAULT_TRUST_PROXY).toBe('loopback');
  });

  test('returns a single address or CIDR as a one-element list', () => {
    expect(resolveTrustProxy('10.244.0.0/16')).toEqual(['10.244.0.0/16']);
  });

  test('splits a comma-separated list and trims whitespace', () => {
    expect(resolveTrustProxy(' 10.0.0.1 , 172.18.0.0/16 ,loopback')).toEqual([
      '10.0.0.1',
      '172.18.0.0/16',
      'loopback',
    ]);
  });
});

describe('trustProxyStartupWarning', () => {
  test('warns in production when TRUSTED_PROXIES is unset', () => {
    const warning = trustProxyStartupWarning({ NODE_ENV: 'production', TRUSTED_PROXIES: undefined });
    expect(warning).toMatch(/TRUSTED_PROXIES is not set/);
    expect(warning).toMatch(/loopback/);
  });

  test('warns in production when TRUSTED_PROXIES is blank', () => {
    expect(trustProxyStartupWarning({ NODE_ENV: 'production', TRUSTED_PROXIES: '   ' })).not.toBeNull();
  });

  test('does not warn in production when TRUSTED_PROXIES is set', () => {
    expect(trustProxyStartupWarning({ NODE_ENV: 'production', TRUSTED_PROXIES: '10.0.0.1' })).toBeNull();
  });

  test('does not warn outside production', () => {
    expect(trustProxyStartupWarning({ NODE_ENV: 'development', TRUSTED_PROXIES: undefined })).toBeNull();
    expect(trustProxyStartupWarning({ NODE_ENV: 'test', TRUSTED_PROXIES: undefined })).toBeNull();
  });
});

describe('deployment manifests', () => {
  test('Kubernetes ConfigMap sets TRUSTED_PROXIES', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'deploy', 'kubernetes', 'config.yaml'), 'utf8');
    expect(manifest).toMatch(/^\s+TRUSTED_PROXIES:\s*"[^"]+"/m);
  });

  test('production docker-compose sets TRUSTED_PROXIES', () => {
    const compose = fs.readFileSync(path.join(ROOT, 'docker-compose.prod.yml'), 'utf8');
    expect(compose).toMatch(/- TRUSTED_PROXIES=/);
  });

  test('Kubernetes TRUSTED_PROXIES is never the wildcard true', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'deploy', 'kubernetes', 'config.yaml'), 'utf8');
    expect(manifest).not.toMatch(/TRUSTED_PROXIES:\s*"?true"?\s*$/m);
  });
});
