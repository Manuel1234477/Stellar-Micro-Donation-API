# OpenAPI Spec Snapshot and Diff Policy

## Overview

The OpenAPI specification is the API contract and must be treated as such. This document outlines how spec changes are managed, reviewed, and validated.

## Canonical Snapshot

The canonical OpenAPI specification is stored in version control:

- **JSON Format**: `docs/openapi.json` (used by CI validation)
- **YAML Format**: `docs/openapi.yaml` (human-readable reference)

Both formats are generated from route JSDoc annotations and stored in `src/config/openapi.js`.

## Workflow: Making API Changes

### 1. Implement Code Changes

Modify route definitions and update JSDoc annotations to reflect the API change.

### 2. Generate Updated Spec

```bash
npm run openapi:generate
```

This produces deterministic output (sorted keys) so the diff is meaningful and stable.

### 3. Review the Spec Diff

```bash
git diff docs/openapi.json
git diff docs/openapi.yaml
```

The diff should clearly show:
- **Additive changes** (new fields, new endpoints) - reviewed for completeness
- **Breaking changes** (removed fields, type narrowing) - flagged for discussion
- **Renames** (field/endpoint name changes) - verified not to break clients

### 4. Commit the Updated Spec

```bash
git add docs/openapi.json docs/openapi.yaml
git commit -m "docs: update OpenAPI spec for [feature]"
```

## CI Validation

### check-openapi-sync.js

Runs in CI (`npm run openapi:check`) to verify:

1. **Byte-Stability**: The committed spec matches the generated spec exactly
   - Ensures no manual edits or accidental diffs
   - Deterministic sorting prevents flakes

2. **Response Example Validation**: Response examples match their schemas
   - Catches outdated examples in documentation

3. **Auth Scheme Verification**: Required security schemes are defined
   - Ensures all endpoints are properly protected

4. **Shared Schema Verification**: Standard response types exist
   - `Error`, `ValidationError`, `UnauthorizedError`, `NotFoundError`

### CI Pipeline

In `.github/workflows/ci.yml`, the `openapi:check` step:
- Regenerates the spec from annotations
- Compares against committed snapshot
- **Fails if they differ** (spec changes require updated snapshot)
- Reports all path counts and defined schemas

## Breaking Change Detection (Future Enhancement)

Future CI enhancements can flag breaking changes more loudly:

- Removed endpoints (HTTP 404)
- Removed fields (data loss)
- Type narrowing (validation failures)
- Renamed fields (client updates required)

## Implementation Details

### Deterministic Output

The `generate-openapi.js` script ensures byte-stable output:

```javascript
const stableSpec = sortObjectKeys(spec);
```

This means:
- Same input always produces same bytes
- Diffs are meaningful (not noise from reordering)
- CI checks for staleness are non-flaky

### Schema Configuration

OpenAPI spec is built from:
- Route JSDoc annotations (see `src/routes/**/*.js`)
- Shared schemas and security definitions (see `src/config/openapi.js`)
- Response examples (inline in route handlers)

## Acceptance Criteria

- ✓ Canonical OpenAPI snapshot is committed in `docs/`
- ✓ CI fails when generated spec differs from committed snapshot
- ✓ Intentional changes are reviewed via snapshot diff in PR
- ✓ Byte-stable output ensures diffs are meaningful
- ✓ All documented endpoints are reachable and respond correctly

## Related Issues

- [#1092](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1092) - Implement OpenAPI spec coverage guarantee
- [#1169](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1169) - Add snapshot/diff check for OpenAPI spec
