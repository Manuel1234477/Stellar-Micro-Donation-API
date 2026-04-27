/**
 * IPFS Utility
 *
 * Pins donation impact certificate JSON to IPFS via the Pinata API.
 * Falls back to local in-memory storage when pinning fails so that
 * donation confirmation is never blocked.
 *
 * Environment variables:
 *   PINATA_API_KEY    - Pinata API key
 *   PINATA_SECRET_KEY - Pinata secret API key
 *   IPFS_GATEWAY_URL  - Public gateway base URL (default: https://gateway.pinata.cloud/ipfs)
 */

'use strict';

const https = require('https');
const log = require('./log');

const GATEWAY_URL = process.env.IPFS_GATEWAY_URL || 'https://gateway.pinata.cloud/ipfs';
const PINATA_ENDPOINT = 'api.pinata.cloud';

/** In-memory fallback store: cid -> certificate JSON */
const _localStore = new Map();

/**
 * Generate a certificate JSON object for a donation.
 *
 * @param {object} donation
 * @param {string|number} donation.id
 * @param {string} donation.senderPublicKey
 * @param {string} donation.receiverPublicKey
 * @param {number|string} donation.amount
 * @param {string} [donation.memo]
 * @param {string} [donation.timestamp]
 * @returns {object} Certificate JSON (no PII beyond public keys)
 */
function generateCertificate(donation) {
  return {
    type: 'DonationImpactCertificate',
    version: '1.0',
    donationId: donation.id,
    donor: donation.senderPublicKey,
    recipient: donation.receiverPublicKey,
    amount: String(donation.amount),
    currency: 'XLM',
    memo: donation.memo || null,
    issuedAt: donation.timestamp || new Date().toISOString(),
  };
}

/**
 * Pin a JSON object to IPFS via Pinata.
 * @param {object} json
 * @returns {Promise<string>} IPFS CID
 */
async function pinToIPFS(json) {
  const apiKey = process.env.PINATA_API_KEY;
  const secretKey = process.env.PINATA_SECRET_KEY;

  if (!apiKey || !secretKey) {
    throw new Error('Pinata credentials not configured');
  }

  const body = JSON.stringify({
    pinataContent: json,
    pinataMetadata: { name: `donation-certificate-${json.donationId}` },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: PINATA_ENDPOINT,
        path: '/pinning/pinJSONToIPFS',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          pinata_api_key: apiKey,
          pinata_secret_api_key: secretKey,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.IpfsHash) resolve(parsed.IpfsHash);
            else reject(new Error(`Pinata error: ${data}`));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Pin a donation certificate to IPFS with graceful fallback.
 *
 * On failure, stores the certificate locally and returns a synthetic CID
 * so that donation confirmation is never blocked.
 *
 * @param {object} donation - Donation record
 * @returns {Promise<{cid: string, gateway: string, pinned: boolean}>}
 */
async function pinCertificate(donation) {
  const cert = generateCertificate(donation);

  try {
    const cid = await pinToIPFS(cert);
    log.info('IPFS', 'Certificate pinned', { donationId: donation.id, cid });
    return { cid, gateway: `${GATEWAY_URL}/${cid}`, pinned: true };
  } catch (err) {
    // Graceful fallback: store locally, return synthetic CID
    const fallbackCid = `local_${Buffer.from(JSON.stringify(cert)).toString('base64').slice(0, 32)}`;
    _localStore.set(fallbackCid, cert);
    log.warn('IPFS', 'Pinning failed, using local fallback', { donationId: donation.id, error: err.message });
    return { cid: fallbackCid, gateway: `${GATEWAY_URL}/${fallbackCid}`, pinned: false };
  }
}

/**
 * Retrieve a certificate from local fallback store (for testing / offline use).
 * @param {string} cid
 * @returns {object|null}
 */
function getLocalCertificate(cid) {
  return _localStore.get(cid) || null;
}

/** Clear local store (for tests). */
function clearLocalStore() {
  _localStore.clear();
}

module.exports = { generateCertificate, pinCertificate, getLocalCertificate, clearLocalStore, GATEWAY_URL };
