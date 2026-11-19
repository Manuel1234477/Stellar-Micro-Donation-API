#!/usr/bin/env node
/* eslint-disable-next-line */

/**
 * validate-examples.js
 *
 * CI guard for `examples/` directory. Fails (exit 1) if:
 *  - Any embedded Stellar public key fails StellarSdk.StrKey.isValidEd25519PublicKey()
 *  - Any embedded Stellar public key contains non-ASCII bytes (Cyrillic homoglyphs,
 *    zero-width characters, etc.) — see issue #1428
 *  - Any request body uses a known-wrong field name (e.g. `publicKey` for the
 *    Create Wallet body, `recipientId` for the custodial donation path,
 *    `donorId` / `recipientId` for the recurring-schedule body)
 *
 * Usage:
 *   node scripts/validate-examples.js
 *   EXAMPLES_BASE_URL=http://localhost:3000 node scripts/validate-examples.js   # also execute against a running server
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed (printed to stderr)
 *   2 — missing dependency (stellar-sdk)
 */

const fs = require('fs');
const path = require('path');

let StellarSdk;
try {
  StellarSdk = require('@stellar/stellar-sdk');
} catch (err) {
  console.error('@stellar/stellar-sdk is required. Install dependencies with: npm ci');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const MD_FILE = process.env.VALIDATE_MD_FILE
  ? path.resolve(process.env.VALIDATE_MD_FILE)
  : path.join(ROOT, 'examples', 'API_CURL_EXAMPLES.md');
const POSTMAN_FILE = process.env.VALIDATE_POSTMAN_FILE
  ? path.resolve(process.env.VALIDATE_POSTMAN_FILE)
  : path.join(ROOT, 'examples', 'Stellar-Micro-Donation-API.postman_collection.json');

const failures = [];
function fail(label, detail) {
  failures.push({ label, detail });
  console.error(`  ✗ ${label}: ${detail}`);
}

/**
 * Validate a single Stellar public key string:
 *  - Pure ASCII (rejects Cyrillic homoglyphs, zero-width chars, etc.)
 *  - Exactly 56 characters
 *  - Passes StellarSdk.StrKey.isValidEd25519PublicKey()
 */
function checkKey(label, key) {
  if (typeof key !== 'string' || key.length === 0) {
    fail(label, `expected non-empty string, got ${typeof key}`);
    return;
  }
  let hasNonAscii = false;
  for (let i = 0; i < key.length; i++) {
    if (key.charCodeAt(i) >= 128) {
      hasNonAscii = true;
      break;
    }
  }
  if (hasNonAscii) {
    const codes = [];
    for (let i = 0; i < key.length; i++) {
      if (key.charCodeAt(i) >= 128) {
        const hex = key.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
        codes.push(`U+${hex}`);
      }
    }
    fail(label, `non-ASCII bytes [${codes.slice(0, 3).join(', ')}${codes.length > 3 ? ', ...' : ''}]: ${key}`);
    return;
  }
  if (key.length !== 56) {
    fail(label, `expected 56 chars, got ${key.length}: ${key}`);
    return;
  }
  if (!StellarSdk.StrKey.isValidEd25519PublicKey(key)) {
    fail(label, `failed StellarSdk.StrKey.isValidEd25519PublicKey(): ${key}`);
    return;
  }
  console.log(`  ✓ ${label}: ${key}`);
}

/**
 * Find lines like  NAME="value"  or  NAME=value  inside a markdown file and
 * return the { name, value } pairs. Used to extract DONOR_PUBLIC_KEY=… from
 * the bash setup block.
 */
function extractBashExports(markdown) {
  const out = {};
  // Parse line-by-line, avoiding regexes entirely so the security plugin
  // can't false-flag them. We support both  export NAME="value"  and
  //  NAME="value"  forms; values must be double-quoted.
  for (const rawLine of markdown.split('\n')) {
    let line = rawLine.trim();
    // Strip inline bash comment after the closing quote, e.g.
    //   export NAME="value" # used in example 3
    const hashIdx = line.indexOf(' #');
    if (hashIdx >= 0) line = line.slice(0, hashIdx).trim();
    let body = line;
    if (body.startsWith('export ')) body = body.slice('export '.length).trim();
    else if (body.startsWith('export\t')) body = body.slice('export\t'.length).trim();
    const eqIdx = body.indexOf('=');
    if (eqIdx <= 0) continue;
    const name = body.slice(0, eqIdx).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) continue;
    const valueRaw = body.slice(eqIdx + 1).trim();
    if (valueRaw.length < 2 || valueRaw[0] !== '"' || valueRaw[valueRaw.length - 1] !== '"') {
      continue;
    }
    out[name] = valueRaw.slice(1, -1);
  }
  return out;
}

/**
 * Locate the first JSON-looking body inside a `### Some Title` markdown
 * section. Returns the parsed object or null if none is found.
 */
function findSectionBody(markdown, label) {
  // Scan line-by-line rather than using a multi-line regex: this is the
  // most ReDoS-safe approach and also more readable. The label values
  // ('Create Wallet', 'Create Donation', 'Create Recurring Donation
  // Schedule') are static ASCII strings.
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  let inFence = false;
  const collected = [];
  for (const line of lines) {
    if (!inSection) {
      if (line.startsWith('### ') && line.slice(4).trim() === label) {
        inSection = true;
      }
      continue;
    }
    if (inFence) {
      if (line.trim().startsWith('```')) {
        // End of the code block.
        const text = collected.join('\n').trim();
        if (!text.startsWith('{') && !text.startsWith('[')) return null;
        try {
          return JSON.parse(text);
        } catch (_) {
          return null;
        }
      }
      collected.push(line);
      continue;
    }
    if (line.trim().startsWith('```') && collected.length === 0) {
      inFence = true;
    }
  }
  return null;
}

function checkMarkdown() {
  console.log(`Validating ${path.relative(ROOT, MD_FILE)}:`);
  if (!fs.existsSync(MD_FILE)) {
    fail('examples/API_CURL_EXAMPLES.md', 'file does not exist');
    return;
  }
  const md = fs.readFileSync(MD_FILE, 'utf8');
  const exports_ = extractBashExports(md);
  const expectedKeys = ['DONOR_PUBLIC_KEY', 'RECIPIENT_PUBLIC_KEY', 'WALLET_PUBLIC_KEY'];
  for (const k of expectedKeys) {
    if (!(k in exports_)) {
      fail(`API_CURL_EXAMPLES.md:${k}`, 'no `export NAME="..."` definition found in setup block');
    } else {
      checkKey(`API_CURL_EXAMPLES.md:${k}`, exports_[k]);
    }
  }

  md.split('\n').forEach((line, idx) => {
    if (line.includes('$BASE_URL/') && !line.includes('$BASE_URL/api/v1/')) {
      fail(`API_CURL_EXAMPLES.md:${idx + 1}`, 'URL must use the versioned /api/v1 prefix');
    }
  });

  const walletBody = findSectionBody(md, 'Create Wallet');
  if (walletBody) {
    if (Object.prototype.hasOwnProperty.call(walletBody, 'publicKey')) {
      fail('API_CURL_EXAMPLES.md:Create Wallet', 'must use "address" (not "publicKey")');
    } else if (!Object.prototype.hasOwnProperty.call(walletBody, 'address')) {
      fail('API_CURL_EXAMPLES.md:Create Wallet', 'missing required "address" field');
    }
  }

  // The custodial donation body is the FIRST "### Create Donation" section.
  // It may or may not exist depending on whether the markdown includes both
  // a custodial and a non-custodial example. Check the first match.
  const donateBody = findSectionBody(md, 'Create Donation');
  if (donateBody) {
    if (Object.prototype.hasOwnProperty.call(donateBody, 'recipientId')) {
      fail('API_CURL_EXAMPLES.md:Create Donation', 'must use "receiverId" (not "recipientId") for the custodial path');
    }
  }

  const streamBody = findSectionBody(md, 'Create Recurring Donation Schedule');
  if (streamBody) {
    if (Object.prototype.hasOwnProperty.call(streamBody, 'donorId')) {
      fail('API_CURL_EXAMPLES.md:Create Recurring Donation Schedule', 'must use "donorPublicKey" (not "donorId")');
    }
    if (Object.prototype.hasOwnProperty.call(streamBody, 'recipientId')) {
      fail('API_CURL_EXAMPLES.md:Create Recurring Donation Schedule', 'must use "recipientPublicKey" (not "recipientId")');
    }
  }
}

function walkCollectionItems(items) {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item && item.item) {
      walkCollectionItems(item.item);
      continue;
    }
    if (!item || !item.request) continue;
    const req = item.request;
    const url = (req.url && (typeof req.url === 'string' ? req.url : req.url.raw)) || '';
    const body = (req.body && typeof req.body.raw === 'string') ? req.body.raw : '';
    if (url.includes('{{BASE_URL}}') && !url.includes('{{BASE_URL}}/api/v1/')) {
      fail(`postman:${item.name || url}`, `URL must use the versioned /api/v1 prefix: ${url}`);
    }
    if (!body.includes('{')) continue;
    let obj = null;
    try { obj = JSON.parse(body); } catch (_) { /* skip non-JSON bodies */ }
    if (!obj || typeof obj !== 'object') continue;

    if (/\/wallets(\?|$)/.test(url) && !/\/wallets\/[^/]+\/transactions/.test(url)) {
      if (Object.prototype.hasOwnProperty.call(obj, 'publicKey')) {
        fail(`postman:${item.name || 'Create Wallet'}`, '/wallets body must use "address" (not "publicKey")');
      }
      if (!Object.prototype.hasOwnProperty.call(obj, 'address')) {
        fail(`postman:${item.name || 'Create Wallet'}`, '/wallets body missing required "address" field');
      }
    }

    if (/\/donations(\?|$)/.test(url) && !/\/donations\//.test(url)) {
      if (Object.prototype.hasOwnProperty.call(obj, 'recipientId') &&
          Object.prototype.hasOwnProperty.call(obj, 'senderId')) {
        fail(`postman:${item.name || 'Create Donation'}`, 'POST /donations body must use "receiverId" (not "recipientId") when using senderId');
      }
      if (Object.prototype.hasOwnProperty.call(obj, 'recipientId') &&
          Object.prototype.hasOwnProperty.call(obj, 'donor')) {
        fail(`postman:${item.name || 'Create Donation'}`, 'POST /donations body must use "recipient" (not "recipientId") when using donor');
      }
    }

    if (/\/stream\/create(\?|$)/.test(url)) {
      if (Object.prototype.hasOwnProperty.call(obj, 'donorId')) {
        fail(`postman:${item.name || 'Create Recurring'}`, '/stream/create body must use "donorPublicKey" (not "donorId")');
      }
      if (Object.prototype.hasOwnProperty.call(obj, 'recipientId')) {
        fail(`postman:${item.name || 'Create Recurring'}`, '/stream/create body must use "recipientPublicKey" (not "recipientId")');
      }
    }
  }
}

function checkPostman() {
  console.log(`\nValidating ${path.relative(ROOT, POSTMAN_FILE)}:`);
  if (!fs.existsSync(POSTMAN_FILE)) {
    fail('examples/Stellar-Micro-Donation-API.postman_collection.json', 'file does not exist');
    return;
  }
  let collection;
  try {
    collection = JSON.parse(fs.readFileSync(POSTMAN_FILE, 'utf8'));
  } catch (err) {
    fail('examples/Stellar-Micro-Donation-API.postman_collection.json', `JSON parse error: ${err.message}`);
    return;
  }
  const variables = Array.isArray(collection.variable) ? collection.variable : [];
  const byKey = {};
  for (const v of variables) {
    if (v && typeof v.key === 'string') byKey[v.key] = v.value;
  }
  const expectedVars = ['DONOR_PUBLIC_KEY', 'RECIPIENT_PUBLIC_KEY', 'WALLET_PUBLIC_KEY'];
  for (const k of expectedVars) {
    if (!(k in byKey)) {
      fail(`postman:${k}`, 'variable not defined in collection');
    } else {
      checkKey(`postman:${k}`, byKey[k]);
    }
  }
  walkCollectionItems(collection.item);
}

/**
 * Live mode (opt-in): when EXAMPLES_BASE_URL is set, every Postman request is
 * sent to that running server (e.g. http://localhost:3000). A request fails if
 * the route is missing (404), redirects (308, unversioned path) or the server
 * errors (5xx). Other 4xx responses are accepted: the examples use placeholder
 * data, so business-rule rejections are expected. SSE streams are skipped
 * because they never complete.
 *
 * Refs #1964.
 */
function collectLiveRequests(items, out) {
  if (!Array.isArray(items)) return out;
  for (const item of items) {
    if (item && item.item) {
      collectLiveRequests(item.item, out);
    } else if (item && item.request) {
      out.push(item);
    }
  }
  return out;
}

function substituteVars(text, vars) {
  let result = text;
  for (const key of Object.keys(vars)) {
    result = result.split('{{' + key + '}}').join(vars[key]);
  }
  return result;
}

async function checkLive() {
  const baseUrl = process.env.EXAMPLES_BASE_URL;
  if (!baseUrl) return;
  console.log(`\nExecuting Postman examples against ${baseUrl}:`);
  let collection;
  try {
    collection = JSON.parse(fs.readFileSync(POSTMAN_FILE, 'utf8'));
  } catch (err) {
    fail('postman:live', `cannot read collection: ${err.message}`);
    return;
  }
  const vars = {};
  for (const v of Array.isArray(collection.variable) ? collection.variable : []) {
    if (v && typeof v.key === 'string') vars[v.key] = String(v.value);
  }
  vars.BASE_URL = baseUrl.replace(/\/+$/, '');
  if (process.env.EXAMPLES_API_KEY) vars.API_KEY = process.env.EXAMPLES_API_KEY;

  for (const item of collectLiveRequests(collection.item, [])) {
    const req = item.request;
    const rawUrl = typeof req.url === 'string' ? req.url : req.url.raw;
    const url = substituteVars(rawUrl, vars);
    const label = `${req.method} ${item.name || url}`;
    if (url.includes('/stream/transactions') || url.includes('/stream/leaderboard')) {
      console.log(`  - ${label}: skipped (SSE stream)`);
      continue;
    }
    const headers = {};
    for (const h of Array.isArray(req.header) ? req.header : []) {
      headers[h.key] = substituteVars(String(h.value), vars);
    }
    const init = { method: req.method, headers, redirect: 'manual', signal: AbortSignal.timeout(10000) };
    if (req.body && typeof req.body.raw === 'string') {
      init.body = substituteVars(req.body.raw, vars);
    }
    let status;
    try {
      const res = await fetch(url, init);
      status = res.status;
      await res.arrayBuffer().catch(() => {});
    } catch (err) {
      fail(label, `request failed: ${err.message}`);
      continue;
    }
    if (status === 404 || status === 308 || status === 301 || status === 302 || status >= 500) {
      fail(label, `HTTP ${status} from ${url}`);
    } else {
      console.log(`  ✓ ${label}: HTTP ${status}`);
    }
  }
}

async function main() {
  checkMarkdown();
  checkPostman();
  await checkLive();
  console.log('');
  if (failures.length === 0) {
    console.log('✓ All example files pass validation');
    process.exit(0);
  } else {
    console.error(`✗ ${failures.length} validation error(s):`);
    for (const f of failures) console.error(`  - ${f.label}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
