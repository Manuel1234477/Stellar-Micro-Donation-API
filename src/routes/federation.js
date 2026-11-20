/**
 * Federation Routes - Stellar Federation Server Layer
 *
 * RESPONSIBILITY: Serve as a Stellar federation server for this domain.
 *   Implements the two required endpoints:
 *     GET /.well-known/stellar.toml  — advertises federation server URL
 *     GET /federation                — name→account_id (type=name) and
 *                                      account_id→name (type=id, reverse lookup)
 *
 * OWNER: Backend Team
 * DEPENDENCIES: express, federation_records table (FederationRecordService)
 *
 * Records are managed at runtime through /admin/federation (issue #1938).
 * FEDERATION_RECORDS is an optional seed inserted on startup; invalid entries
 * are skipped with a warning. The in-memory federationRegistry Map is kept for
 * backward compatibility only; GET /federation reads the database.
 */

'use strict';
const { bestEffort } = require('../utils/bestEffort');

const express = require('express');
const StellarSdk = require('@stellar/stellar-sdk');
const router = express.Router();
const log = require('../utils/log');
const config = require('../config');
const { resolveSep10SigningSecret } = require('../utils/sep10SigningKey');
const Database = require('../utils/database');
const FederationRecordService = require('../services/FederationRecordService');

/**
 * Seed federation records from FEDERATION_RECORDS env var into the database.
 * Each record is inserted with INSERT OR IGNORE so existing entries are preserved.
 * Exported so tests can call it after seeding the in-memory env.
 */
async function seedFederationRecordsFromEnv() {
  try {
    const raw = process.env.FEDERATION_RECORDS;
    if (!raw) return;
    const parsed = JSON.parse(raw);
    for (const [name, value] of Object.entries(parsed)) {
      const entry = typeof value === 'string' ? { account_id: value } : value;
      const checked = FederationRecordService.validateRecord({
        name,
        account_id: entry.account_id,
        memo_type: entry.memo_type,
        memo: entry.memo,
      });
      if (!checked.valid) {
        log.warn('FEDERATION', 'Skipping invalid FEDERATION_RECORDS entry', { name, errors: checked.errors });
        continue;
      }
      await Database.run(
        `INSERT OR IGNORE INTO federation_records (name, account_id, memo_type, memo)
         VALUES (?, ?, ?, ?)`,
        [
          checked.value.name,
          checked.value.account_id,
          checked.value.memo_type,
          checked.value.memo,
        ]
      );
    }
  } catch (_) { /* invalid JSON or DB not ready — ignore */ }
}

// Seed on module load (best-effort; errors are swallowed)
seedFederationRecordsFromEnv().catch(bestEffort('src/routes/federation.js:53'));

// Keep a backward-compatible in-memory Map for modules that import federationRegistry directly.
// It is populated from the env var for compatibility but the GET /federation route reads from the DB.
const federationRegistry = new Map();
try {
  const raw = process.env.FEDERATION_RECORDS;
  if (raw) {
    const parsed = JSON.parse(raw);
    for (const [name, value] of Object.entries(parsed)) {
      const entry = typeof value === 'string' ? { account_id: value } : value;
      const checked = FederationRecordService.validateRecord({ name, ...entry });
      if (checked.valid) federationRegistry.set(checked.value.name, entry);
    }
  }
} catch (_) { /* invalid JSON — ignore */ }

/**
 * Renders the stellar.toml body. Pure function of its inputs so it can be cached.
 * @param {{ domain: string, scheme: string, host: string, signingPublicKey: string|null }} input
 * @returns {string}
 */
function renderStellarToml({ domain, scheme, host, signingPublicKey }) {
  const federationUrl = `${scheme}://${domain}/federation`;
  // Prefer the configured public URL so a proxy's Host header cannot change the advertised endpoint
  const publicBase = (process.env.API_BASE_URL || `${scheme}://${host}`).replace(/\/+$/, '');
  const webAuthEndpoint = `${publicBase}/auth`;

  const lines = [
    `# Stellar TOML for ${domain}`,
    'VERSION="1.0.0"',
    `NETWORK_PASSPHRASE="${config.stellar.environment.networkPassphrase}"`,
    `FEDERATION_SERVER="${federationUrl}"`,
    `WEB_AUTH_ENDPOINT="${webAuthEndpoint}"`,
    // AUTH_SERVER is the pre-SEP-10 name, kept for clients that have not migrated
    `AUTH_SERVER="${webAuthEndpoint}"`,
  ];

  if (signingPublicKey) {
    lines.push(`SIGNING_KEY="${signingPublicKey}"`);
  }

  return lines.join('\n');
}

let cachedToml = null;

/**
 * Returns the public key of the configured SEP-10 signing secret, or null when
 * none is configured or the value is invalid. Invalid values are logged, never thrown,
 * and startup checks reject them.
 * @returns {string|null}
 */
function getSep10SigningPublicKey() {
  const { secret, dedicated } = resolveSep10SigningSecret();
  if (!secret) {
    log.debug('FEDERATION', 'No SEP-10 signing key configured; omitting SIGNING_KEY from stellar.toml');
    return null;
  }
  try {
    return StellarSdk.Keypair.fromSecret(secret).publicKey();
  } catch (err) {
    log.warn('FEDERATION', 'Invalid SEP-10 signing key; omitting SIGNING_KEY from stellar.toml', {
      source: dedicated ? 'SEP10_SIGNING_KEY' : 'STELLAR_SECRET/SERVICE_SECRET_KEY',
      error: err.message,
    });
    return null;
  }
}

/**
 * GET /.well-known/stellar.toml
 * Advertises this server as a federation server (SEP-0002) and its SEP-0010
 * web auth endpoint. This is the only handler for this path (issue #1779).
 * CORS must be open (*) per the Stellar protocol spec.
 *
 * The body is rebuilt only when its inputs change (issue #1888).
 */
router.get('/.well-known/stellar.toml', (req, res) => {
  const domain = process.env.FEDERATION_DOMAIN || req.hostname || 'localhost';
  const scheme = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
  const host = req.get('host') || 'localhost';
  const signingPublicKey = getSep10SigningPublicKey();

  const cacheKey = [domain, scheme, host, process.env.API_BASE_URL || '', signingPublicKey || ''].join('|');
  if (!cachedToml || cachedToml.key !== cacheKey) {
    cachedToml = { key: cacheKey, body: renderStellarToml({ domain, scheme, host, signingPublicKey }) };
  }

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Access-Control-Allow-Origin', '*');
  res.send(cachedToml.body);
});

/**
 * GET /federation
 * Stellar federation protocol endpoint.
 * Supports type=name (address lookup) only — the primary use-case.
 *
 * Query params:
 *   q    - federation address (name*domain) or account ID
 *   type - "name" | "id" (only "name" is implemented)
 */
router.get('/federation', async (req, res) => {
  const { q, type } = req.query;

  if (!q || !type) {
    return res.status(400).json({
      detail: 'Missing required query parameters: q, type',
    });
  }

  if (type === 'id') {
    return handleReverseLookup(req, res, String(q));
  }

  if (type !== 'name') {
    // The server understands the federation endpoint but does not implement
    // this lookup type, so report the protocol's 501 Not Implemented status.
    return res.status(501).json({
      detail: `Unsupported federation lookup type "${type}". Only "name" and "id" are supported.`,
    });
  }

  // Extract the local part (before the *)
  const atIndex = q.indexOf('*');
  if (atIndex === -1) {
    return res.status(400).json({ detail: 'Invalid federation address format. Expected name*domain.' });
  }

  const name = q.slice(0, atIndex).toLowerCase();
  const entry = await Database.get(
    'SELECT account_id, memo_type, memo FROM federation_records WHERE name = ?',
    [name]
  );

  if (!entry) {
    log.debug('FEDERATION_SERVER', 'Address not found', { q });
    return res.status(404).json({ detail: `Federation address not found: ${q}` });
  }

  log.debug('FEDERATION_SERVER', 'Resolved address', { q, account_id: entry.account_id });

  const response = {
    stellar_address: q,
    account_id: entry.account_id,
  };
  if (entry.memo_type) response.memo_type = entry.memo_type;
  if (entry.memo) response.memo = entry.memo;

  res.set('Access-Control-Allow-Origin', '*');
  return res.json(response);
});

/**
 * SEP-0002 reverse lookup (type=id): account id → federation address.
 * Returns the first name in name order when an account has several.
 */
async function handleReverseLookup(req, res, accountId) {
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(accountId)) {
    return res.status(400).json({ detail: 'Invalid account id for type=id lookup.' });
  }

  const entry = await FederationRecordService.getByAccountId(accountId);
  if (!entry) {
    log.debug('FEDERATION_SERVER', 'No federation address for account', { account_id: accountId });
    return res.status(404).json({ detail: `No federation address for account: ${accountId}` });
  }

  const domain = process.env.FEDERATION_DOMAIN || req.hostname || 'localhost';
  const response = {
    stellar_address: `${entry.name}*${domain}`,
    account_id: entry.account_id,
  };
  if (entry.memo_type) response.memo_type = entry.memo_type;
  if (entry.memo) response.memo = entry.memo;

  res.set('Access-Control-Allow-Origin', '*');
  return res.json(response);
}

module.exports = { router, federationRegistry, renderStellarToml };
