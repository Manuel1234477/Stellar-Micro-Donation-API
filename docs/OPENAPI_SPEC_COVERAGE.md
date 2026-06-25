# OpenAPI Spec Coverage Guarantee

## Overview

This document describes the mechanisms that guarantee the OpenAPI specification covers all routes and is enforced in CI, addressing issue #1092.

## Key Features

### 1. Byte-Stable Output (Deterministic Generation)

The OpenAPI generator (`scripts/generate-openapi.js`) produces **byte-stable, deterministically-ordered output**. This ensures:

- Committed `docs/openapi.json` diffs are meaningful and reviewable
- CI staleness detection is non-flaky (spec changes are reproducible)
- Key ordering is consistent across runs

**Implementation:**
```javascript
// In src/config/openapi.js
function sortObjectKeys(obj) {
  // Recursively sorts all object keys alphabetically
  // Ensures deterministic JSON serialization
}
```

### 2. Schema Validation

Response examples in the OpenAPI spec are validated against their schemas using **AJV** (JSON Schema validator).

**Checks:**
- All response examples match their declared schema
- No undocumented response codes
- Shared error schemas (Error, ValidationError, UnauthorizedError, NotFoundError) are used consistently

### 3. Auth Scheme Verification

The spec verification ensures:
- Required security schemes (ApiKeyAuth) are defined
- Security schemes are referenced in operations
- RBAC scopes and API-version variants are represented

**Example:**
```json
"components": {
  "securitySchemes": {
    "ApiKeyAuth": {
      "type": "apiKey",
      "in": "header",
      "name": "x-api-key"
    }
  }
}
```

### 4. Shared Components

Common response envelopes, pagination, and error structures are defined once and referenced:

```json
"components": {
  "schemas": {
    "Error": { ... },
    "ValidationError": { ... },
    "UnauthorizedError": { ... },
    "NotFoundError": { ... },
    "PaginationMeta": { ... }
  },
  "responses": {
    "Unauthorized": { "$ref": "#/components/schemas/UnauthorizedError" },
    "NotFound": { "$ref": "#/components/schemas/NotFoundError" },
    "ValidationError": { "$ref": "#/components/schemas/ValidationError" }
  }
}
```

### 5. CI Enforcement

The CI pipeline runs `npm run openapi:check` on every PR, which executes:

1. **check-openapi-sync.js** - Verifies:
   - Spec is byte-stable (committed == generated)
   - Response examples validate against schemas
   - Auth schemes are defined
   - Shared schemas exist

2. **verify-route-coverage.js** - Verifies:
   - All required main endpoints are documented
   - All shared schemas are defined
   - All auth schemes are properly configured

**CI Configuration** (`.github/workflows/ci.yml`):
```yaml
- run: npm run openapi:check
```

## Usage

### Generate Updated Spec

After adding new routes or modifying JSDoc annotations:

```bash
npm run openapi:generate
git add docs/openapi.json docs/openapi.yaml
git commit -m "docs: update OpenAPI spec"
```

### Verify Coverage

To verify the spec covers all required endpoints:

```bash
npm run openapi:check
```

Output:
```
✓ docs/openapi.json is byte-stable and in sync with route annotations.
✓ All required auth schemes are properly defined.
✓ All required shared response schemas are defined.

✓ All OpenAPI checks passed!
  - 27 documented paths
  - 5 shared schemas
  - Byte-stable output verified

Verifying OpenAPI spec documentation...

Found 27 documented paths

✓ All required endpoints are documented
✓ OpenAPI spec contains 27 paths
✓ All 4 required schemas are defined
✓ All auth schemes are properly defined
```

## JSDoc Annotations

Routes are documented using JSDoc comments with OpenAPI 3.0 syntax:

```javascript
/**
 * @openapi
 * /donations:
 *   post:
 *     summary: Create a new donation
 *     tags: [Donations]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateDonationRequest'
 *     responses:
 *       '201':
 *         description: Donation created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Donation'
 *             example:
 *               success: true
 *               data: { id: 1, amount: 10.5 }
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '422':
 *         $ref: '#/components/responses/ValidationError'
 */
```

## Route Files Included

The OpenAPI generator scans these route files for JSDoc annotations:

```javascript
apis: [
  'src/routes/donation.js',
  'src/routes/wallet.js',
  'src/routes/stream.js',
  'src/routes/transaction.js',
  'src/routes/stats.js',
  'src/routes/liquidity-pools.js',
  'src/app.js',
  'src/routes/admin/auditLogExport.js',
]
```

## Quality Assurance

### Preventing Spec Drift

1. **Pull Request Gates**: CI blocks PRs if spec is out of sync
2. **Meaningful Diffs**: Byte-stable output makes code reviews easier
3. **Schema Validation**: Examples are validated automatically
4. **Coverage Checks**: Required endpoints must be documented

### Production Readiness

- Spec is validated before every deploy
- Generated SDKs are consistent and accurate
- API consumers have up-to-date documentation
- Breaking changes are caught at spec generation time

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run openapi:generate` | Regenerate `docs/openapi.json` and `docs/openapi.yaml` with deterministic output |
| `npm run openapi:check` | Verify spec is byte-stable, routes are covered, and schemas are valid |
| `node scripts/check-openapi-sync.js` | Low-level sync and schema validation check |
| `node scripts/verify-route-coverage.js` | Verify required endpoints and schemas are documented |

## References

- [OpenAPI 3.0 Specification](https://spec.openapis.org/oas/v3.0.3)
- [Swagger JSDoc](https://github.com/Surnet/swagger-jsdoc)
- [AJV JSON Schema Validator](https://ajv.js.org/)
- [Issue #1092](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1092)
