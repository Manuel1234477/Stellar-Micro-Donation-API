#!/usr/bin/env node
/**
 * scripts/generate-error-codes.js
 *
 * Generates docs/ERROR_CODES.md from the single source of truth in
 * src/utils/errors.js.  Run manually or via `npm run docs:error-codes`.
 *
 * Usage:
 *   node scripts/generate-error-codes.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load the source of truth ──────────────────────────────────────────────────
const { ERROR_CODES } = require('../src/utils/errors');

// ── HTTP status mapping ───────────────────────────────────────────────────────
// Derived from the error classes in errors.js and how each code is used in-code.
const HTTP_STATUS = {
  // Validation (400)
  VALIDATION_ERROR:          400,
  INVALID_REQUEST:           400,
  INVALID_LIMIT:             400,
  INVALID_OFFSET:            400,
  INVALID_DATE_FORMAT:       400,
  INVALID_AMOUNT:            400,
  INVALID_FREQUENCY:         400,
  MISSING_REQUIRED_FIELD:    400,
  IDEMPOTENCY_KEY_REQUIRED:  400,
  INVALID_SCHEMA_VERSION:    400,

  // Auth (401 / 403)
  UNAUTHORIZED:              401,
  INVALID_API_KEY:           401,
  ACCESS_DENIED:             403,
  INSUFFICIENT_PERMISSIONS:  403,

  // Not found (404)
  NOT_FOUND:                 404,
  WALLET_NOT_FOUND:          404,
  TRANSACTION_NOT_FOUND:     404,
  USER_NOT_FOUND:            404,
  DONATION_NOT_FOUND:        404,
  ENDPOINT_NOT_FOUND:        404,

  // Conflict / duplicate (409)
  DUPLICATE_TRANSACTION:     409,
  DUPLICATE_DONATION:        409,
  RESOURCE_CONFLICT:         409,

  // Rate limiting (429)
  RATE_LIMIT_EXCEEDED:       429,

  // Business logic (422)
  INSUFFICIENT_BALANCE:      422,
  TRANSACTION_FAILED:        422,
  INVALID_STATE_TRANSITION:  422,
  FEE_BUMP_MAX_ATTEMPTS:     422,
  FEE_BUMP_EXCEEDS_CAP:      422,
  FEE_BUMP_INVALID_STATE:    422,
  FEE_BUMP_NO_ENVELOPE:      422,
  FEE_BUMP_FAILED:           422,
  ROUTING_STRATEGY_REQUIRED: 422,
  INVALID_ROUTING_STRATEGY:  422,
  POOL_NAME_REQUIRED:        422,
  POOL_NOT_FOUND:            422,
  POOL_EMPTY:                422,
  POOL_ALREADY_EXISTS:       422,
  RECIPIENT_NOT_IN_POOL:     422,
  DONOR_COORDINATES_REQUIRED:422,
  NO_ELIGIBLE_RECIPIENTS:    422,
  NO_ACTIVE_CAMPAIGNS:       422,
  RECIPIENT_ACCOUNT_NOT_FOUND:422,

  // Server errors (500 / 503)
  INTERNAL_ERROR:            500,
  DATABASE_ERROR:            500,
  VERIFICATION_FAILED:       500,
  SERVICE_UNAVAILABLE:       503,
  STELLAR_NETWORK_ERROR:     503,
  EXTERNAL_SERVICE_ERROR:    503,
  NOT_IMPLEMENTED:           501,
};

// ── Human-readable descriptions & remediation ─────────────────────────────────
const DESCRIPTIONS = {
  VALIDATION_ERROR:          { meaning: 'The request body or query parameters failed schema validation.', remediation: 'Check the `details` array in the error response for the specific fields that failed validation.' },
  INVALID_REQUEST:           { meaning: 'The request is malformed or contains an unrecognised combination of parameters.', remediation: 'Review the API reference for the endpoint and correct the request.' },
  INVALID_LIMIT:             { meaning: '`limit` query parameter is not a positive integer or exceeds the maximum allowed value.', remediation: 'Use an integer between 1 and the documented maximum (e.g. 100).' },
  INVALID_OFFSET:            { meaning: '`offset` query parameter is negative or not an integer.', remediation: 'Use a non-negative integer.' },
  INVALID_DATE_FORMAT:       { meaning: 'A date field does not conform to the expected format (ISO 8601).', remediation: 'Pass dates as `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DD`.' },
  INVALID_AMOUNT:            { meaning: 'The donation amount is outside the allowed range, has too many decimal places, or is not a number.', remediation: 'Use a positive numeric value within `GET /donations/limits`. Max 7 decimal places (XLM precision).' },
  INVALID_FREQUENCY:         { meaning: 'The recurring-donation frequency value is not one of the accepted values.', remediation: 'Use one of: `daily`, `weekly`, `monthly`.' },
  MISSING_REQUIRED_FIELD:    { meaning: 'A required request field is absent.', remediation: 'Add the missing field. Check the `details` array for the field name.' },
  IDEMPOTENCY_KEY_REQUIRED:  { meaning: 'The `Idempotency-Key` header is required for this endpoint but was not provided.', remediation: 'Include a unique `Idempotency-Key` header (UUID recommended).' },
  INVALID_SCHEMA_VERSION:    { meaning: 'The `X-Schema-Version` header specifies a schema version that is not supported.', remediation: 'Omit the header to use the current version, or use a supported version string.' },

  UNAUTHORIZED:              { meaning: 'No API key was provided, or the provided key is invalid / expired.', remediation: 'Include a valid `X-API-Key` header. Obtain a key from the administrator.' },
  INVALID_API_KEY:           { meaning: 'The API key is syntactically invalid, revoked, or expired.', remediation: 'Check the key value and expiry. Generate a new key with `npm run keys:create`.' },
  ACCESS_DENIED:             { meaning: 'The request was authenticated but the API key does not have the required permissions.', remediation: 'Use an API key with the appropriate role (`admin`, `user`, etc.).' },
  INSUFFICIENT_PERMISSIONS:  { meaning: 'The API key\'s scope does not include the specific permission required for this operation.', remediation: 'Request a key with the required permission scope from the administrator.' },

  NOT_FOUND:                 { meaning: 'The requested resource does not exist.', remediation: 'Verify the ID or path. The resource may have been deleted.' },
  WALLET_NOT_FOUND:          { meaning: 'No wallet record exists for the given ID or public key.', remediation: 'Create the wallet first via `POST /wallets`, or verify the public key.' },
  TRANSACTION_NOT_FOUND:     { meaning: 'No transaction record exists for the given ID.', remediation: 'Verify the transaction ID. It may not have been synced yet — try `POST /transactions/sync`.' },
  USER_NOT_FOUND:            { meaning: 'No user record exists for the given ID.', remediation: 'Verify the user ID or create a new wallet/user record.' },
  DONATION_NOT_FOUND:        { meaning: 'No donation record exists for the given ID.', remediation: 'Verify the donation ID. Use `GET /donations` to list existing records.' },
  ENDPOINT_NOT_FOUND:        { meaning: 'The requested URL path does not match any route.', remediation: 'Check the API reference for the correct endpoint path.' },

  DUPLICATE_TRANSACTION:     { meaning: 'A transaction with the same identifying data already exists.', remediation: 'Use idempotency keys to safely retry. Check if the previous attempt succeeded with `GET /donations/:id`.' },
  DUPLICATE_DONATION:        { meaning: 'A donation with the same `Idempotency-Key` was already processed.', remediation: 'The original response is returned. No new donation was created — this is safe to ignore on retry.' },
  RESOURCE_CONFLICT:         { meaning: 'The request conflicts with the current state of the resource.', remediation: 'Fetch the current state of the resource and retry with updated values.' },

  RATE_LIMIT_EXCEEDED:       { meaning: 'The client has exceeded the request rate limit for this endpoint.', remediation: 'Wait for the window to expire (see `Retry-After` and `X-RateLimit-*` response headers) and retry.' },

  INSUFFICIENT_BALANCE:      { meaning: 'The sender\'s account does not have enough XLM to cover the donation amount plus network fees.', remediation: 'Fund the sender account or reduce the donation amount.' },
  TRANSACTION_FAILED:        { meaning: 'The Stellar transaction was submitted but rejected by the network.', remediation: 'Check `details` for the specific Stellar error code. Common causes: bad sequence number, insufficient fee, or invalid operation.' },
  INVALID_STATE_TRANSITION:  { meaning: 'The requested status change is not allowed from the resource\'s current state.', remediation: 'Check the allowed state transitions in the API reference (e.g. a `completed` donation cannot be set to `pending`).' },
  FEE_BUMP_MAX_ATTEMPTS:     { meaning: 'The fee-bump retry limit was reached without the transaction being confirmed.', remediation: 'Check Stellar network conditions. Consider increasing `FEE_BUMP_MAX_FEE_STROOPS` and retrying.' },
  FEE_BUMP_EXCEEDS_CAP:      { meaning: 'The computed fee bump would exceed the configured maximum fee cap.', remediation: 'Increase `FEE_BUMP_MAX_FEE_STROOPS` or wait for network fees to decrease.' },
  FEE_BUMP_INVALID_STATE:    { meaning: 'A fee bump was attempted on a transaction that is not in a bumpable state.', remediation: 'Only `pending` transactions can be fee-bumped. Verify the transaction status first.' },
  FEE_BUMP_NO_ENVELOPE:      { meaning: 'No transaction envelope is available for fee bumping.', remediation: 'The original transaction XDR is missing. The transaction must be re-submitted from scratch.' },
  FEE_BUMP_FAILED:           { meaning: 'The fee-bump transaction itself was rejected by the Stellar network.', remediation: 'Check `details` for the Stellar result code. Verify the service account has sufficient XLM for fees.' },
  ROUTING_STRATEGY_REQUIRED: { meaning: 'A donation routing strategy must be specified.', remediation: 'Provide a `strategy` field (`round_robin`, `geo_proximity`, etc.) in the request.' },
  INVALID_ROUTING_STRATEGY:  { meaning: 'The provided routing strategy is not recognised.', remediation: 'Use one of the documented strategy names.' },
  POOL_NAME_REQUIRED:        { meaning: 'A recipient pool name is required for this operation.', remediation: 'Include the `poolName` field in the request body.' },
  POOL_NOT_FOUND:            { meaning: 'No recipient pool exists with the given name.', remediation: 'Create the pool first via the admin endpoint.' },
  POOL_EMPTY:                { meaning: 'The recipient pool has no eligible recipients.', remediation: 'Add recipients to the pool before routing donations.' },
  POOL_ALREADY_EXISTS:       { meaning: 'A pool with this name already exists.', remediation: 'Use a different name or update the existing pool.' },
  RECIPIENT_NOT_IN_POOL:     { meaning: 'The specified recipient is not a member of the given pool.', remediation: 'Verify the recipient public key and pool name.' },
  DONOR_COORDINATES_REQUIRED:{ meaning: 'Geo-proximity routing requires the donor\'s coordinates.', remediation: 'Include `donorLat` and `donorLng` fields in the request.' },
  NO_ELIGIBLE_RECIPIENTS:    { meaning: 'No recipients in the pool met the routing criteria (e.g. geo-proximity filter).', remediation: 'Expand the search radius, add more recipients, or use a different routing strategy.' },
  NO_ACTIVE_CAMPAIGNS:       { meaning: 'There are no active campaigns available for this operation.', remediation: 'Create or activate a campaign before submitting campaign-targeted donations.' },
  RECIPIENT_ACCOUNT_NOT_FOUND:{ meaning: 'The recipient\'s Stellar account does not exist on the network.', remediation: 'Fund and activate the recipient account on the Stellar network before sending donations.' },

  INTERNAL_ERROR:            { meaning: 'An unexpected server-side error occurred.', remediation: 'Retry the request. If it persists, check server logs and contact support with the `requestId` from the response.' },
  DATABASE_ERROR:            { meaning: 'A database operation failed.', remediation: 'Retry the request. If it persists, check database connectivity and disk space. Contact support with the `requestId`.' },
  VERIFICATION_FAILED:       { meaning: 'A cryptographic or integrity check failed.', remediation: 'Check that the data being verified has not been tampered with. For Stellar transactions, verify the XDR is valid.' },
  SERVICE_UNAVAILABLE:       { meaning: 'The server is temporarily unable to process requests.', remediation: 'Check `GET /health`. Retry after the window indicated by the `Retry-After` header.' },
  STELLAR_NETWORK_ERROR:     { meaning: 'Communication with the Stellar Horizon API failed.', remediation: 'Check Stellar network status at https://status.stellar.org. Retry with exponential back-off.' },
  EXTERNAL_SERVICE_ERROR:    { meaning: 'A call to an external service (e.g. price oracle, IPFS, SMTP) failed.', remediation: 'Check the optional-integrations status in `GET /health`. The feature requiring the external service is temporarily unavailable.' },
  NOT_IMPLEMENTED:           { meaning: 'This endpoint or feature is not yet implemented.', remediation: 'Check the roadmap or use an alternative endpoint.' },
};

// ── Category grouping ─────────────────────────────────────────────────────────
const CATEGORIES = [
  { title: 'Validation Errors',              range: [1000, 1099] },
  { title: 'Authentication / Authorization', range: [2000, 2099] },
  { title: 'Not Found',                      range: [3000, 3099] },
  { title: 'Conflict / Duplicate',           range: [4000, 4099] },
  { title: 'Business Logic',                 range: [5000, 5099] },
  { title: 'Rate Limiting',                  range: [6000, 6099] },
  { title: 'Server Errors',                  range: [9000, 9999] },
];

function getCategory(numeric) {
  return CATEGORIES.find(c => numeric >= c.range[0] && numeric <= c.range[1])?.title ?? 'Other';
}

// ── Build grouped table ───────────────────────────────────────────────────────
const byCategory = {};
for (const [name, entry] of Object.entries(ERROR_CODES)) {
  const cat = getCategory(entry.numeric);
  if (!byCategory[cat]) byCategory[cat] = [];
  byCategory[cat].push({
    code:        entry.code,
    numeric:     entry.numeric,
    http:        HTTP_STATUS[name] ?? 500,
    meaning:     DESCRIPTIONS[name]?.meaning     ?? '—',
    remediation: DESCRIPTIONS[name]?.remediation ?? '—',
  });
}
// Sort by numeric within each category
for (const rows of Object.values(byCategory)) {
  rows.sort((a, b) => a.numeric - b.numeric);
}

// ── Representative response-body examples ────────────────────────────────────
const EXAMPLES = `
## Error Response Body

Every error response uses this envelope:

\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "numericCode": 1000,
    "message": "amount must be a positive number",
    "details": [
      { "field": "amount", "message": "must be > 0" }
    ],
    "requestId": "req_01HZ7GXKJ8QCVW9ABCDEF",
    "timestamp": "2026-06-29T12:00:00.000Z"
  }
}
\`\`\`

### Fields

| Field | Type | Description |
|-------|------|-------------|
| \`success\` | boolean | Always \`false\` for error responses |
| \`error.code\` | string | Machine-readable error code |
| \`error.numericCode\` | integer | Stable numeric identifier |
| \`error.message\` | string | Human-readable description |
| \`error.details\` | array? | Per-field validation details (validation errors only) |
| \`error.requestId\` | string? | Correlation ID — include this when reporting bugs |
| \`error.timestamp\` | string | ISO 8601 timestamp of the error |

---

## Representative Examples

### 400 — Validation Error

\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "numericCode": 1000,
    "message": "Request validation failed",
    "details": [
      { "field": "amount", "message": "must be a positive number" },
      { "field": "senderPublicKey", "message": "must be a valid Stellar public key" }
    ],
    "requestId": "req_01HZ7GXKJ8QCVW9ABCDEF",
    "timestamp": "2026-06-29T12:00:00.000Z"
  }
}
\`\`\`

### 401 — Unauthorized

\`\`\`json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "numericCode": 2000,
    "message": "Unauthorized",
    "requestId": "req_01HZ7GXKJ8QCVW9ABCDEF",
    "timestamp": "2026-06-29T12:00:00.000Z"
  }
}
\`\`\`

### 404 — Not Found

\`\`\`json
{
  "success": false,
  "error": {
    "code": "DONATION_NOT_FOUND",
    "numericCode": 3004,
    "message": "Donation not found",
    "requestId": "req_01HZ7GXKJ8QCVW9ABCDEF",
    "timestamp": "2026-06-29T12:00:00.000Z"
  }
}
\`\`\`

### 422 — Insufficient Balance

\`\`\`json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "numericCode": 5000,
    "message": "Sender account has insufficient XLM balance",
    "requestId": "req_01HZ7GXKJ8QCVW9ABCDEF",
    "timestamp": "2026-06-29T12:00:00.000Z"
  }
}
\`\`\`

### 429 — Rate Limit Exceeded

\`\`\`json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "numericCode": 6000,
    "message": "Too many requests",
    "requestId": "req_01HZ7GXKJ8QCVW9ABCDEF",
    "timestamp": "2026-06-29T12:00:00.000Z"
  }
}
\`\`\`

### 503 — Stellar Network Error

\`\`\`json
{
  "success": false,
  "error": {
    "code": "STELLAR_NETWORK_ERROR",
    "numericCode": 9004,
    "message": "Unable to reach Stellar Horizon — try again later",
    "requestId": "req_01HZ7GXKJ8QCVW9ABCDEF",
    "timestamp": "2026-06-29T12:00:00.000Z"
  }
}
\`\`\`
`;

// ── Build the markdown ────────────────────────────────────────────────────────
const now = new Date().toISOString();
let md = `<!-- AUTO-GENERATED — do not edit by hand.
     Regenerate with: node scripts/generate-error-codes.js
     Source of truth: src/utils/errors.js
     Last generated: ${now} -->

# Error Code Reference

This reference is **generated automatically** from
[\`src/utils/errors.js\`](../src/utils/errors.js) — the single source of truth
for all error codes.  Do not edit this file by hand; run the generator instead:

\`\`\`bash
node scripts/generate-error-codes.js
# or
npm run docs:error-codes
\`\`\`

---

## Table of Contents

`;

for (const cat of CATEGORIES) {
  if (byCategory[cat.title]) {
    const anchor = cat.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '-');
    md += `- [${cat.title}](#${anchor})\n`;
  }
}

md += `\n---\n`;

// Per-category tables
for (const cat of CATEGORIES) {
  const rows = byCategory[cat.title];
  if (!rows || rows.length === 0) continue;
  const anchor = cat.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '-');
  md += `\n## ${cat.title}\n\n`;
  md += `| Code | Numeric | HTTP | Meaning | Remediation |\n`;
  md += `|------|---------|------|---------|-------------|\n`;
  for (const r of rows) {
    md += `| \`${r.code}\` | ${r.numeric} | ${r.http} | ${r.meaning} | ${r.remediation} |\n`;
  }
}

md += `\n---\n`;
md += EXAMPLES;
md += `\n---\n\n*Source: [\`src/utils/errors.js\`](../src/utils/errors.js)*\n`;

// ── Write output ──────────────────────────────────────────────────────────────
const outPath = path.resolve(__dirname, '../docs/ERROR_CODES.md');
fs.writeFileSync(outPath, md, 'utf8');
console.log(`✓ Generated ${outPath}`);
