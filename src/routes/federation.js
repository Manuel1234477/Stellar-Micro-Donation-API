/**
 * Federation Routes - Stellar Federation Server Layer
 *
 * RESPONSIBILITY: Serve as a Stellar federation server for this domain.
 *   Implements the two required endpoints:
 *     GET /.well-known/stellar.toml  — advertises federation server URL
 *     GET /federation                — resolves name→account_id queries
 *
 * OWNER: Backend Team
 * DEPENDENCIES: express, federation registry (in-memory for now)
 *
 * To register a user: call federationRegistry.set(name, { account_id, memo_type?, memo? })
 * The registry is exported so tests and other modules can populate it.
 */

'use strict';

const express = require('express');
const router = express.Router();
const log = require('../utils/log');
const config = require('../config');

/**
 * In-memory federation registry: name (lowercase) → { account_id, memo_type?, memo? }
 * Populated via FEDERATION_RECORDS env var (JSON) or programmatically.
 *
 * Env var format (example): FEDERATION_RECORDS with JSON value
 * eslint-disable-next-line no-secrets/no-secrets
 */
const federationRegistry = new Map();

// Seed from environment variable if provided
try {
  const raw = process.env.FEDERATION_RECORDS;
  if (raw) {
    const parsed = JSON.parse(raw);
    for (const [name, value] of Object.entries(parsed)) {
      const entry = typeof value === 'string' ? { account_id: value } : value;
      federationRegistry.set(name.toLowerCase(), entry);
    }
  }
} catch (_) { /* invalid JSON — ignore */ }

/**
 * GET /.well-known/stellar.toml
 * Advertises this server as a federation server.
 * CORS must be open (*) per the Stellar protocol spec.
 */
router.get('/.well-known/stellar.toml', (req, res) => {
  const domain = process.env.FEDERATION_DOMAIN || req.hostname || 'localhost';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : req.protocol;
  const federationUrl = `${protocol}://${domain}/federation`;

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Access-Control-Allow-Origin', '*');
  res.send([
    `# Stellar TOML for ${domain}`,
    `FEDERATION_SERVER="${federationUrl}"`,
    `NETWORK_PASSPHRASE="${config.stellar.environment.networkPassphrase}"`,
  ].join('\n'));
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
router.get('/federation', (req, res) => {
  const { q, type } = req.query;

  if (!q || !type) {
    return res.status(400).json({
      detail: 'Missing required query parameters: q, type',
    });
  }

  if (type !== 'name') {
    return res.status(501).json({
      detail: `Federation lookup type "${type}" is not supported. Only "name" is supported.`,
    });
  }

  // Extract the local part (before the *)
  const atIndex = q.indexOf('*');
  if (atIndex === -1) {
    return res.status(400).json({ detail: 'Invalid federation address format. Expected name*domain.' });
  }

  const name = q.slice(0, atIndex).toLowerCase();
  const entry = federationRegistry.get(name);

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

module.exports = { router, federationRegistry };
