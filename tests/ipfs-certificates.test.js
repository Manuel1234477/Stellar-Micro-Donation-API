'use strict';

/**
 * Tests for IPFS donation impact certificates
 * Covers: certificate generation, CID storage, IPFS failure graceful handling,
 * gateway URL returned correctly
 */

const { generateCertificate, pinCertificate, getLocalCertificate, clearLocalStore } = require('../src/utils/ipfs');

const SAMPLE_DONATION = {
  id: 42,
  senderPublicKey: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
  receiverPublicKey: 'GXYZ1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890',
  amount: '10.0000000',
  memo: 'test donation',
  timestamp: '2024-01-01T00:00:00.000Z',
};

describe('IPFS Donation Certificates', () => {
  beforeEach(() => {
    clearLocalStore();
    // Ensure no real Pinata credentials in tests
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_SECRET_KEY;
  });

  // ── Certificate generation ──────────────────────────────────────────────────

  it('generates a certificate with required fields', () => {
    const cert = generateCertificate(SAMPLE_DONATION);
    expect(cert.type).toBe('DonationImpactCertificate');
    expect(cert.donationId).toBe(42);
    expect(cert.donor).toBe(SAMPLE_DONATION.senderPublicKey);
    expect(cert.recipient).toBe(SAMPLE_DONATION.receiverPublicKey);
    expect(cert.amount).toBe('10.0000000');
    expect(cert.currency).toBe('XLM');
    expect(cert.memo).toBe('test donation');
  });

  it('certificate contains no PII beyond public keys', () => {
    const cert = generateCertificate(SAMPLE_DONATION);
    const certStr = JSON.stringify(cert);
    // Should not contain secret keys or email addresses
    expect(certStr).not.toMatch(/secret/i);
    expect(certStr).not.toMatch(/@/);
  });

  // ── Pinning with fallback ───────────────────────────────────────────────────

  it('falls back to local storage when Pinata credentials are missing', async () => {
    const result = await pinCertificate(SAMPLE_DONATION);
    expect(result.cid).toBeDefined();
    expect(result.gateway).toContain(result.cid);
    expect(result.pinned).toBe(false); // fallback
  });

  it('IPFS failure does NOT throw — donation is not blocked', async () => {
    // Even with no credentials, pinCertificate resolves (never rejects)
    await expect(pinCertificate(SAMPLE_DONATION)).resolves.toBeDefined();
  });

  it('stores certificate in local fallback store on failure', async () => {
    const result = await pinCertificate(SAMPLE_DONATION);
    const stored = getLocalCertificate(result.cid);
    expect(stored).not.toBeNull();
    expect(stored.donationId).toBe(42);
  });

  // ── Gateway URL ─────────────────────────────────────────────────────────────

  it('returns a gateway URL containing the CID', async () => {
    const result = await pinCertificate(SAMPLE_DONATION);
    expect(result.gateway).toMatch(/^https?:\/\//);
    expect(result.gateway).toContain(result.cid);
  });

  // ── Successful pin (mocked) ─────────────────────────────────────────────────

  it('returns pinned=true and real CID when Pinata succeeds', async () => {
    // Mock the https request to simulate Pinata success
    const https = require('https');
    const originalRequest = https.request;

    https.request = jest.fn((opts, cb) => {
      const mockRes = {
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(JSON.stringify({ IpfsHash: 'QmTestCID123' }));
          if (event === 'end') handler();
        }),
      };
      cb(mockRes);
      return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    });

    process.env.PINATA_API_KEY = 'test-key';
    process.env.PINATA_SECRET_KEY = 'test-secret';

    const result = await pinCertificate(SAMPLE_DONATION);
    expect(result.cid).toBe('QmTestCID123');
    expect(result.pinned).toBe(true);
    expect(result.gateway).toContain('QmTestCID123');

    https.request = originalRequest;
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_SECRET_KEY;
  });

  // ── CID stored in transaction record (unit) ─────────────────────────────────

  it('generateCertificate includes donationId for CID traceability', () => {
    const cert = generateCertificate({ ...SAMPLE_DONATION, id: 99 });
    expect(cert.donationId).toBe(99);
  });
});
