# Design Document

## Overview

This design introduces a machine-readable API changelog and deprecation feed to complement the existing human-readable `CHANGELOG.md`. The system currently generates changelog content from conventional commits via `scripts/generate-changelog.js`, producing prose entries grouped by change type. This feature extends the changelog generation process to simultaneously produce a structured JSON format (`CHANGELOG.json`) that captures metadata enabling programmatic consumption: change type, affected endpoints, version, timestamp, and commit hash.

The structured changelog enables integrators to build automated alerts for breaking changes, track deprecations programmatically, and filter changes by endpoint. Optionally, the system can expose REST endpoints (`GET /changelog` and `GET /deprecations`) for polling access. The structured format is kept in sync via CI validation alongside the existing `check-openapi-sync.js` script.

## Architecture

### Current State

```
┌──────────────────────────────────────────────────────┐
│  scripts/generate-changelog.js                       │
│  - Parses conventional commits since last tag        │
│  - Groups by type (feat, fix, docs, etc.)            │
│  - Outputs markdown sections                         │
│  - Writes to CHANGELOG.md                            │
└──────────────────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────┐
│  CHANGELOG.md                                        │
│  - Human-readable prose entries                      │
│  - Grouped by version and type                       │
│  - Not machine-parseable                             │
└──────────────────────────────────────────────────────┘
```

### Target State

```
┌──────────────────────────────────────────────────────────────┐
│  scripts/generate-changelog.js (enhanced)                    │
│  - Parses conventional commits since last tag                │
│  - Extracts: type, description, breaking, endpoints          │
│  - Generates both markdown AND JSON outputs                  │
└──────────────────────────────────────────────────────────────┘
            │                            │
            ▼                            ▼
┌─────────────────────┐    ┌────────────────────────────────┐
│  CHANGELOG.md       │    │  CHANGELOG.json                │
│  (unchanged format) │    │  - schemaVersion               │
│                     │    │  - changes: [...]              │
└─────────────────────┘    │    - version                   │
                           │    - type                       │
                           │    - description                │
                           │    - affectedEndpoints          │
                           │    - timestamp                  │
                           │    - commitHash                 │
                           │    - isBreaking                 │
                           └────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│  CI Validation (scripts/check-changelog-sync.js)             │
│  - Validates schema version                                  │
│  - Cross-references endpoints with OpenAPI spec              │
│  - Ensures JSON is in sync with git history                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Optional REST Endpoints (src/routes/changelog.js)           │
│  - GET /changelog?since={version}&type={type}&endpoint={path}│
│  - GET /deprecations (filters type=deprecated)               │
└──────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Enhanced Changelog Generator (`scripts/generate-changelog.js`)

**Purpose**: Generate both human-readable and machine-readable changelog outputs from conventional commits

**New Function**:
```javascript
/**
 * Extracts endpoint references from commit body
 * Looks for patterns like:
 *   Endpoints: POST /donations, GET /wallets/:id
 *   Affects: GET /health
 * @param {string} body - Commit message body
 * @returns {Array<{method: string, path: string}>}
 */
function extractAffectedEndpoints(body)
```

**New Function**:
```javascript
/**
 * Builds structured change entry for JSON output
 * @param {Object} parsed - Parsed commit (type, description, hash, isBreaking)
 * @param {string} version - Release version
 * @param {Date} timestamp - Commit timestamp
 * @returns {Object} Change entry with all required fields
 */
function buildChangeEntry(parsed, version, timestamp)
```

**Modified Function**:
```javascript
/**
 * Main entry point (modified to generate both outputs)
 */
function main() {
  const lastTag = getLastTag();
  const commits = getCommitsSince(lastTag);
  
  // Generate markdown (existing logic)
  const markdownSection = buildSection(commits, lastTag);
  
  // NEW: Generate JSON
  const jsonEntries = commits.map(c => buildChangeEntry(c, 'Unreleased', new Date()));
  const structuredChangelog = {
    schemaVersion: '1.0.0',
    changes: jsonEntries
  };
  
  // Write both outputs
  if (shouldWrite) {
    updateMarkdownChangelog(markdownSection);
    writeStructuredChangelog(structuredChangelog);  // NEW
  }
}
```

**Change Entry Format**:
```javascript
{
  "version": "1.2.0",
  "type": "deprecated",              // added|changed|deprecated|removed|fixed|security
  "description": "Deprecate GET /v1/wallets endpoint",
  "affectedEndpoints": [
    { "method": "GET", "path": "/v1/wallets" }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z",
  "commitHash": "a1b2c3d4e5f6g7h8i9j0",
  "isBreaking": false,
  "sunsetDate": "2024-04-15T00:00:00.000Z",  // Optional, for deprecations
  "removalVersion": "2.0.0"                   // Optional, for deprecations
}
```

**Structured Changelog File Format** (`CHANGELOG.json`):
```javascript
{
  "schemaVersion": "1.0.0",
  "changes": [
    { /* change entry */ },
    { /* change entry */ },
    ...
  ]
}
```

**Endpoint Annotation Pattern in Commit Messages**:
Developers should add endpoint annotations in commit body:
```
feat: add pagination to wallet listing endpoint

Endpoints: GET /wallets

This adds limit and offset query parameters to support pagination.
```

For deprecations specifically:
```
feat!: deprecate v1 wallet endpoint in favor of v2

Endpoints: GET /v1/wallets
Sunset: 2024-04-15
Removal: 2.0.0

BREAKING CHANGE: GET /v1/wallets will return Deprecation and Sunset headers.
```

**
Implementation Notes**:
- Backward compatible: existing `npm run changelog` continues to work
- New flag: `npm run changelog:write` updates both CHANGELOG.md and CHANGELOG.json
- Parsing extracts endpoints from commit body using regex patterns
- Falls back to empty `affectedEndpoints` array if no annotations present
- Deprecation-specific fields (sunsetDate, removalVersion) extracted from commit body tags

### 2. Structured Changelog Validator (`scripts/check-changelog-sync.js`)

**Purpose**: Validate structured changelog in CI pipeline

**Main Function**:
```javascript
function validateChangelog() {
  // 1. Load and parse CHANGELOG.json
  const changelog = JSON.parse(fs.readFileSync('CHANGELOG.json', 'utf8'));
  
  // 2. Validate schema version
  if (changelog.schemaVersion !== '1.0.0') {
    throw new Error('Unsupported schema version');
  }
  
  // 3. Validate each change entry
  for (const entry of changelog.changes) {
    validateChangeEntry(entry);
  }
  
  // 4. Cross-reference endpoints with OpenAPI spec
  const openapi = require('../docs/openapi.json');
  validateEndpointReferences(changelog, openapi);
  
  // 5. Ensure JSON is in sync with git history
  validateGitSync(changelog);
}
```

**Endpoint Validation**:
```javascript
function validateEndpointReferences(changelog, openapi) {
  const validEndpoints = new Set();
  
  // Build set of valid endpoints from OpenAPI spec
  for (const [path, methods] of Object.entries(openapi.paths)) {
    for (const method of Object.keys(methods)) {
      if (method !== 'parameters') {
        validEndpoints.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  
  // Check each change entry
  for (const entry of changelog.changes) {
    // Skip non-implementation types
    if (['docs', 'test', 'chore', 'ci'].includes(entry.type)) continue;
    
    // Allow "removed" entries to reference non-existent endpoints
    if (entry.type === 'removed') continue;
    
    // Validate endpoint exists
    for (const endpoint of entry.affectedEndpoints) {
      const key = `${endpoint.method} ${endpoint.path}`;
      if (!validEndpoints.has(key)) {
        console.error(`Invalid endpoint reference: ${key} in version ${entry.version}`);
        process.exit(1);
      }
    }
  }
}
```

**Git Sync Validation**:
```javascript
function validateGitSync(changelog) {
  const lastTag = getLastTag();
  const commits = getCommitsSince(lastTag);
  const expectedHashes = new Set(commits.map(c => c.hash));
  
  const unreleasedEntries = changelog.changes.filter(c => c.version === 'Unreleased');
  for (const entry of unreleasedEntries) {
    if (!expectedHashes.has(entry.commitHash)) {
      console.error(`Changelog entry with commit ${entry.commitHash} not found in git history`);
      process.exit(1);
    }
  }
}
```

**CI Integration**:
Add to `package.json`:
```json
{
  "scripts": {
    "changelog:check": "node scripts/check-changelog-sync.js"
  }
}
```

Add to `.github/workflows/ci.yml` (if using GitHub Actions):
```yaml
- name: Validate Changelog Sync
  run: npm run changelog:check
```

### 3. Optional REST Endpoints (`src/routes/changelog.js`)

**Purpose**: Expose structured changelog via REST API for polling access

**Feature Flag**:
```javascript
// In .env or environment config
ENABLE_CHANGELOG_ENDPOINT=true
```

**Route Definitions**:
```javascript
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '../../CHANGELOG.json');

/**
 * GET /changelog
 * Returns structured changelog with optional filters
 * 
 * Query params:
 *   ?since={version}     - Only changes after this version
 *   ?type={change_type}  - Filter by type (added, deprecated, etc.)
 *   ?endpoint={path}     - Filter by endpoint path (partial match)
 */
router.get('/changelog', (req, res) => {
  try {
    const changelog = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
    let { changes } = changelog;
    
    // Apply filters
    if (req.query.since) {
      changes = changes.filter(c => compareVersions(c.version, req.query.since) > 0);
    }
    
    if (req.query.type) {
      changes = changes.filter(c => c.type === req.query.type);
    }
    
    if (req.query.endpoint) {
      changes = changes.filter(c =>
        c.affectedEndpoints.some(e => e.path.includes(req.query.endpoint))
      );
    }
    
    res.json({
      success: true,
      schemaVersion: changelog.schemaVersion,
      changes: changes
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'CHANGELOG_READ_ERROR',
        message: 'Failed to read structured changelog'
      }
    });
  }
});

/**
 * GET /deprecations
 * Returns only deprecated features, sorted by sunset date
 */
router.get('/deprecations', (req, res) => {
  try {
    const changelog = JSON.parse(fs.readFileSync(CHANGELOG_PATH, 'utf8'));
    const deprecations = changelog.changes
      .filter(c => c.type === 'deprecated')
      .sort((a, b) => {
        if (!a.sunsetDate) return 1;
        if (!b.sunsetDate) return -1;
        return new Date(a.sunsetDate) - new Date(b.sunsetDate);
      });
    
    res.json({
      success: true,
      schemaVersion: changelog.schemaVersion,
      deprecations: deprecations
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: {
        code: 'DEPRECATIONS_READ_ERROR',
        message: 'Failed to read deprecations'
      }
    });
  }
});

module.exports = router;
```

**Registration in `src/app.js`**:
```javascript
if (process.env.ENABLE_CHANGELOG_ENDPOINT === 'true') {
  const changelogRoutes = require('./routes/changelog');
  app.use('/', changelogRoutes);
}
```

### 4. Deprecation Header Integration

**Purpose**: Ensure changelog deprecation entries align with HTTP Deprecation/Sunset headers

**Middleware for Deprecated Endpoints** (`src/middleware/deprecation.js`):
```javascript
/**
 * Middleware to emit Deprecation and Sunset headers for deprecated endpoints
 * @param {string} sunsetDate - ISO 8601 date when endpoint will be removed
 * @param {string} message - Deprecation message
 */
function deprecationHeaders(sunsetDate, message = 'This endpoint is deprecated') {
  return (req, res, next) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', new Date(sunsetDate).toUTCString());
    res.set('Link', '</changelog>; rel="deprecation"');
    next();
  };
}

module.exports = { deprecationHeaders };
```

**Example Usage**:
```javascript
const { deprecationHeaders } = require('../middleware/deprecation');

// Apply to deprecated endpoint
router.get('/v1/wallets',
  deprecationHeaders('2024-04-15T00:00:00.000Z', 'Use GET /v2/wallets instead'),
  getWalletsV1Handler
);
```

**Validation Check**:
The `check-changelog-sync.js` script should verify that:
1. All endpoints marked as deprecated in CHANGELOG.json have corresponding middleware
2. Sunset dates match between changelog and headers

## Data Models

No database schema changes required. All data is stored in files and served from filesystem.

**Structured Changelog Schema** (JSON Schema):
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["schemaVersion", "changes"],
  "properties": {
    "schemaVersion": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+$"
    },
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["version", "type", "description", "affectedEndpoints", "timestamp", "commitHash"],
        "properties": {
          "version": { "type": "string" },
          "type": { 
            "type": "string", 
            "enum": ["added", "changed", "deprecated", "removed", "fixed", "security"]
          },
          "description": { "type": "string" },
          "affectedEndpoints": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["method", "path"],
              "properties": {
                "method": { "type": "string" },
                "path": { "type": "string" }
              }
            }
          },
          "timestamp": { "type": "string", "format": "date-time" },
          "commitHash": { "type": "string" },
          "isBreaking": { "type": "boolean" },
          "sunsetDate": { "type": "string", "format": "date-time" },
          "removalVersion": { "type": "string" }
        }
      }
    }
  }
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Before writing the correctness properties, let me perform the prework analysis:


### Property 1: Commit Parsing Extracts All Required Fields

*For any* valid conventional commit message, the parser SHALL extract and populate the Change_Type, description, and commitHash fields correctly.

**Validates: Requirements 1.2**

### Property 2: Breaking Change Detection

*For any* conventional commit containing breaking change indicators (BREAKING CHANGE in body or "!" after type), the generated Change_Entry SHALL have isBreaking set to true.

**Validates: Requirements 1.3**

### Property 3: Change Entry Structure Completeness

*For any* Change_Entry in the Structured_Changelog, it SHALL contain all required fields (version, type, description, affectedEndpoints, timestamp, commitHash) with correct types: strings for version/type/description/commitHash, array for affectedEndpoints, ISO 8601 string for timestamp.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 2.1**

### Property 4: Endpoint Annotation Parsing

*For any* conventional commit with endpoint annotations in the body (e.g., "Endpoints: POST /donations, GET /wallets"), the parser SHALL extract all listed Affected_Endpoint values into the affectedEndpoints array.

**Validates: Requirements 2.2, 2.5**

### Property 5: Endpoint Object Structure

*For any* Affected_Endpoint in a Change_Entry, the endpoint object SHALL have exactly two fields: method (HTTP verb string) and path (endpoint path string).

**Validates: Requirements 2.3**

### Property 6: Change Type Constraint

*For any* Change_Entry, the type field SHALL be one of the standardized values: "added", "changed", "deprecated", "removed", "fixed", or "security".

**Validates: Requirements 3.4**

### Property 7: Changelog Accumulation

*For any* sequence of changelog generation runs, the Structured_Changelog SHALL maintain all previous Change_Entry records and append new ones, never removing historical entries.

**Validates: Requirements 4.5**

### Property 8: Changelog Endpoint Sort Order

*For any* response from GET /changelog, the changes array SHALL be sorted by timestamp in descending order (newest first).

**Validates: Requirements 5.2**

### Property 9: Changelog Filtering Correctness

*For any* query parameters (since, type, endpoint) provided to GET /changelog, the returned changes array SHALL contain only entries matching all provided filters, and SHALL include all entries that match.

**Validates: Requirements 5.3, 5.4, 5.5**

### Property 10: Deprecations Endpoint Filtering

*For any* response from GET /deprecations, the returned array SHALL contain only Change_Entry objects where type equals "deprecated", and SHALL include all such entries from the changelog.

**Validates: Requirements 6.2**

### Property 11: Deprecations Sort Order

*For any* response from GET /deprecations, entries with sunsetDate values SHALL be sorted by sunsetDate ascending (soonest first), and entries without sunsetDate SHALL appear after those with dates.

**Validates: Requirements 6.5**

### Property 12: Schema Version Format

*For any* generated Structured_Changelog, the schemaVersion field SHALL match the semantic versioning pattern (e.g., "1.0.0").

**Validates: Requirements 8.2**

### Property 13: Schema Validation

*For any* generated Structured_Changelog, when validated against the declared schemaVersion schema, it SHALL pass validation without errors.

**Validates: Requirements 8.5**

### Property 14: Endpoint Reference Validation

*For any* Change_Entry with type not in ["docs", "test", "chore", "ci", "removed"] and containing affectedEndpoints, each endpoint SHALL exist in the current OpenAPI specification.

**Validates: Requirements 9.1, 9.2, 9.5**

### Property 15: Removed Endpoint Exception

*For any* Change_Entry with type "removed", the endpoint validation SHALL allow references to endpoints not in the current OpenAPI spec (historical endpoints).

**Validates: Requirements 9.3**

### Property 16: Git History Sync Detection

*For any* Structured_Changelog, when the validation script checks git history, it SHALL detect and report any Change_Entry whose commitHash does not exist in the git repository or whose metadata does not match the actual commit.

**Validates: Requirements 4.2, 4.4**

### Property 17: Deprecation Consistency Validation

*For any* Change_Entry with type "deprecated" and affectedEndpoints, the validation script SHALL verify that deprecation metadata (sunsetDate, removalVersion) is consistent with endpoint header configuration if such configuration exists.

**Validates: Requirements 7.5**

## Error Handling

### Changelog Generation Errors

**Invalid Commit Format**:
- If a commit does not follow conventional commit format, skip it and log a warning
- Continue processing remaining commits
- Invalid commits are not fatal - generator produces changelog from valid commits only

**Endpoint Annotation Parse Errors**:
- If endpoint annotation syntax is malformed, log warning with commit hash
- Set affectedEndpoints to empty array for that commit
- Continue processing

**File Write Errors**:
- If CHANGELOG.json write fails, exit with error code 1
- Log descriptive error message
- Do not partially write the file (use atomic write: tmp file + rename)

### Validation Errors

**Missing CHANGELOG.json**:
- `check-changelog-sync.js` exits with error code 1
- Clear error message: "CHANGELOG.json not found. Run: npm run changelog:write"

**Invalid JSON Structure**:
- Exit with error code 1
- Report specific JSON parsing error and line number

**Schema Validation Failures**:
- Exit with error code 1
- Report all schema violations found (don't stop at first error)
- List entry version/commitHash for each violation

**Endpoint Reference Errors**:
- Exit with error code 1
- List all invalid endpoint references with entry details
- Suggest running `npm run openapi:generate` to update OpenAPI spec

**Git Sync Errors**:
- Exit with error code 1
- Report commit hashes that don't match git history
- Suggest regenerating changelog

### REST Endpoint Errors

**File Read Errors** (GET /changelog, GET /deprecations):
```javascript
{
  "success": false,
  "error": {
    "code": "CHANGELOG_READ_ERROR",
    "message": "Failed to read structured changelog"
  }
}
```
Status: 500

**Invalid Query Parameters**:
```javascript
{
  "success": false,
  "error": {
    "code": "INVALID_QUERY_PARAMETER",
    "message": "Invalid value for parameter 'type'. Must be one of: added, changed, deprecated, removed, fixed, security"
  }
}
```
Status: 400

**Feature Disabled**:
If `ENABLE_CHANGELOG_ENDPOINT !== 'true'`, endpoint returns 404

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests:

**Unit Tests** verify specific examples and integration:
- Specific commit message parsing examples (feat, fix, BREAKING CHANGE)
- Endpoint annotation extraction examples
- REST endpoint integration (request/response cycle)
- File I/O operations (read/write changelog)
- Specific validation scenarios (missing fields, invalid schema)

**Property Tests** verify universal correctness across all inputs:
- Commit parsing works for all valid conventional commit formats
- Filtering and sorting properties hold for all possible datasets
- Validation catches all classes of errors

### Property-Based Testing Configuration

Use **fast-check** (JavaScript property-based testing library) with:
- Minimum 100 iterations per property test
- Custom generators for commit messages, changelog entries, endpoint references
- Each test tagged with: **Feature: machine-readable-api-changelog, Property {N}: {property text}**

### Test Coverage

**Unit Tests** (`tests/changelog/changelog-generation.test.js`):
1. Parse conventional commit (feat, fix, docs types)
2. Extract breaking change indicators
3. Parse endpoint annotations (single and multiple)
4. Handle malformed endpoint annotations gracefully
5. Generate valid JSON output
6. Write to filesystem successfully
7. Atomic write behavior (tmp file + rename)

**Unit Tests** (`tests/changelog/changelog-validation.test.js`):
1. Validate correct changelog structure
2. Detect missing required fields
3. Detect invalid change types
4. Cross-reference with OpenAPI spec
5. Allow removed endpoints in "removed" entries
6. Skip validation for docs/test/chore/ci types
7. Validate git sync (matching commit hashes)
8. Detect manual edits (mismatched hashes)

**Unit Tests** (`tests/routes/changelog.test.js`):
1. GET /changelog returns changelog when feature enabled
2. GET /changelog returns 404 when feature disabled
3. Query parameter filtering (since, type, endpoint)
4. GET /deprecations returns only deprecated entries
5. Deprecations sorted by sunset date
6. Error handling (file not found, invalid JSON)
7. Invalid query parameter validation

**Property Tests** (`tests/property/changelog-properties.test.js`):

**Property Test 1: Commit Parsing Completeness**
- Generate random conventional commits (various types, with/without breaking indicators)
- Parse each commit
- Assert: type, description, commitHash extracted correctly
- Assert: isBreaking matches presence of indicators
- **Feature: machine-readable-api-changelog, Property 1: Commit parsing extracts all required fields**
- **Feature: machine-readable-api-changelog, Property 2: Breaking change detection**

**Property Test 2: Change Entry Structure**
- Generate random change entries
- Assert: All required fields present with correct types
- Assert: Timestamp is valid ISO 8601
- Assert: Type is in valid set
- **Feature: machine-readable-api-changelog, Property 3: Change entry structure completeness**
- **Feature: machine-readable-api-changelog, Property 6: Change type constraint**

**Property Test 3: Endpoint Parsing and Structure**
- Generate random commits with endpoint annotations
- Parse annotations
- Assert: All endpoints extracted
- Assert: Each endpoint has method and path fields
- **Feature: machine-readable-api-changelog, Property 4: Endpoint annotation parsing**
- **Feature: machine-readable-api-changelog, Property 5: Endpoint object structure**

**Property Test 4: Changelog Filtering**
- Generate random changelog with various entries
- Apply random filter combinations (since, type, endpoint)
- Assert: Results match filter criteria
- Assert: No entries excluded that should be included
- **Feature: machine-readable-api-changelog, Property 9: Changelog filtering correctness**

**Property Test 5: Sort Order Properties**
- Generate random changelog entries with timestamps
- Fetch via /changelog endpoint
- Assert: Sorted by timestamp descending
- Generate random deprecation entries with sunset dates
- Fetch via /deprecations endpoint
- Assert: Sorted by sunsetDate ascending
- **Feature: machine-readable-api-changelog, Property 8: Changelog endpoint sort order**
- **Feature: machine-readable-api-changelog, Property 11: Deprecations sort order**

**Property Test 6: Endpoint Validation**
- Generate random change entries with endpoints
- Load OpenAPI spec
- Run validation
- Assert: Invalid endpoints detected for non-excluded types
- Assert: Removed entries allow non-existent endpoints
- Assert: Docs/test/chore/ci entries skip validation
- **Feature: machine-readable-api-changelog, Property 14: Endpoint reference validation**
- **Feature: machine-readable-api-changelog, Property 15: Removed endpoint exception**

**Property Test 7: Schema Validation**
- Generate random changelogs (valid and invalid structures)
- Run schema validation
- Assert: Valid structures pass
- Assert: Invalid structures fail with descriptive errors
- **Feature: machine-readable-api-changelog, Property 13: Schema validation**

### Integration Tests

**CI Workflow Integration** (`tests/integration/ci-changelog.test.js`):
1. Simulate git commits
2. Run changelog generation
3. Verify both CHANGELOG.md and CHANGELOG.json created
4. Run validation script
5. Verify validation passes
6. Manually edit CHANGELOG.json (corrupt it)
7. Run validation script
8. Verify validation fails

**Deprecation Header Integration** (`tests/integration/deprecation-headers.test.js`):
1. Create changelog entry with type="deprecated" and affectedEndpoints
2. Verify endpoint has deprecation middleware configured
3. Make request to deprecated endpoint
4. Assert: Deprecation and Sunset headers present
5. Assert: Header values match changelog entry

### Test Isolation

**Filesystem Cleanup**:
- Use temporary directories for test file generation
- Clean up after each test in afterEach hooks
- Mock fs operations where appropriate

**Git State Isolation**:
- Mock git command execution (execSync)
- Use fixtures for commit data
- Don't depend on real git history in tests

**REST Endpoint Isolation**:
- Use supertest for HTTP testing
- Start test server per test suite
- Close server in afterAll hooks

