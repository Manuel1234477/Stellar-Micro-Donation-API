'use strict';

/**
 * Inbound webhook source definitions (#1786)
 *
 * The inbound-webhook verifier keeps its registered sources in a per-process
 * Map. That is only correct across replicas if every replica registers the
 * same sources at boot, so they are declared in configuration rather than
 * registered ad hoc at runtime.
 *
 * INBOUND_WEBHOOK_SOURCES is a JSON array:
 *   [{ "name": "stripe", "secretEnv": "STRIPE_WEBHOOK_SECRET",
 *      "headerName": "stripe-signature", "signaturePrefix": "" }]
 *
 * `secretEnv` names the variable holding the HMAC secret so the secret itself
 * never sits inside the JSON value.
 */

const { readEnv } = require('./env');

/**
 * @param {object} [source=process.env]
 * @returns {{ sources: Array<{name: string, secret: string, headerName: string, signaturePrefix: string}>, errors: string[] }}
 */
function loadInboundWebhookSources(source = process.env) {
  const defs = readEnv('INBOUND_WEBHOOK_SOURCES', source);
  const sources = [];
  const errors = [];
  if (!defs) return { sources, errors };

  if (!Array.isArray(defs)) {
    errors.push('INBOUND_WEBHOOK_SOURCES must be a JSON array');
    return { sources, errors };
  }

  defs.forEach((def, i) => {
    const where = `INBOUND_WEBHOOK_SOURCES[${i}]`;
    if (!def || typeof def !== 'object') {
      errors.push(`${where} must be an object`);
      return;
    }
    const { name, secretEnv, headerName, signaturePrefix = '' } = def;
    if (!name || !secretEnv || !headerName) {
      errors.push(`${where} requires name, secretEnv and headerName`);
      return;
    }
    const secret = source[secretEnv];
    if (!secret) {
      errors.push(`${where} (${name}): ${secretEnv} is not set`);
      return;
    }
    sources.push({ name, secret, headerName, signaturePrefix });
  });

  return { sources, errors };
}

module.exports = { loadInboundWebhookSources };
