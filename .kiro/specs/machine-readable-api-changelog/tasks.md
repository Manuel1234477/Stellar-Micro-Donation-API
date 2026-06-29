# Implementation Plan: Machine-Readable API Changelog

## Overview

This implementation extends the existing `scripts/generate-changelog.js` to produce both human-readable (CHANGELOG.md) and machine-readable (CHANGELOG.json) outputs. It adds CI validation via `scripts/check-changelog-sync.js`, optional REST endpoints for programmatic access, and deprecation header middleware integration. The structured format enables integrators to build automated alerts for breaking changes and track deprecations.

## Tasks

- [ ] 1. Enhance changelog generator to produce structured JSON output
  - [ ] 1.1 Add endpoint annotation extraction function to `scripts/generate-changelog.js`
    - Implement `extractAffectedEndpoints(body)` to parse endpoint annotations from commit body
    - Support patterns: "Endpoints: POST /donations, GET /wallets"
    - Return array of { method, path } objects
    - Handle multiple endpoints per commit
    - _Requirements: 2.2, 2.3, 2.5_
  
  - [ ] 1.2 Add Change_Entry builder function to `scripts/generate-changelog.js`
    - Implement `buildChangeEntry(parsed, version, timestamp)` function
    - Extract sunsetDate and removalVersion from commit body for deprecations
    - Support tags: "Sunset: YYYY-MM-DD", "Removal: X.Y.Z"
    - Populate all required fields: version, type, description, affectedEndpoints, timestamp, commitHash, isBreaking
    - _Requirements: 1.2, 1.3, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_
  
  - [ ] 1.3 Add structured changelog generation to main() function
    - Map commits to Change_Entry objects using buildChangeEntry
    - Construct structured changelog object with schemaVersion and changes array
    - Implement writeStructuredChangelog function for atomic file writes (tmp + rename)
    - Write to CHANGELOG.json alongside existing CHANGELOG.md
    - _Requirements: 1.1, 1.4, 1.5_
  
  - [ ]* 1.4 Write property tests for changelog generation
    - **Property 1: Commit parsing extracts all required fields**
    - **Property 2: Breaking change detection**
    - **Property 3: Change entry structure completeness**
    - **Property 4: Endpoint annotation parsing**
    - **Property 5: Endpoint object structure**
    - **Property 6: Change type constraint**
    - Generate random conventional commits with fast-check
    - Verify parsing, structure, and field extraction
    - _Requirements: 1.2, 1.3, 2.2, 2.3, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 2. Create changelog validation script for CI
  - [ ] 2.1 Create `scripts/check-changelog-sync.js` with schema validation
    - Load and parse CHANGELOG.json
    - Validate schemaVersion matches expected version (1.0.0)
    - Validate each Change_Entry against required fields and types
    - Implement JSON Schema validation for structured changelog
    - Report all validation errors (don't stop at first)
    - _Requirements: 8.1, 8.2, 8.5_
  
  - [ ] 2.2 Add endpoint reference validation
    - Load OpenAPI spec from docs/openapi.json
    - Build set of valid endpoint + method combinations
    - For each Change_Entry, validate affectedEndpoints exist in OpenAPI spec
    - Skip validation for types: docs, test, chore, ci
    - Allow non-existent endpoints for type "removed"
    - Generate validation report listing invalid references
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_
  
  - [ ] 2.3 Add git history sync validation
    - Get commits since last tag using existing git helper functions
    - Build set of expected commit hashes
    - Verify all "Unreleased" Change_Entry commitHash values exist in git history
    - Report any mismatched or missing commits
    - _Requirements: 4.2, 4.4_
  
  - [ ]* 2.4 Write property tests for validation logic
    - **Property 13: Schema validation**
    - **Property 14: Endpoint reference validation**
    - **Property 15: Removed endpoint exception**
    - **Property 16: Git history sync detection**
    - Generate random valid and invalid changelog structures
    - Verify validation catches all error classes
    - _Requirements: 4.2, 4.4, 8.5, 9.1, 9.2, 9.3, 9.5_
  
  - [ ] 2.5 Add validation script to package.json and CI workflow
    - Add "changelog:check" script to package.json
    - Document usage in README or contributing guide
    - _Requirements: 4.2_

- [ ] 3. Checkpoint - Validate changelog generation and validation
  - Run `npm run changelog:write` to generate CHANGELOG.json
  - Run `npm run changelog:check` to validate output
  - Verify both scripts work correctly with current git history
  - Ensure all tests pass

- [ ] 4. Implement optional REST endpoints for changelog access
  - [ ] 4.1 Create `src/routes/changelog.js` with GET /changelog endpoint
    - Implement route handler to read and parse CHANGELOG.json
    - Add query parameter support: ?since={version}
    - Add query parameter support: ?type={type}
    - Add query parameter support: ?endpoint={path}
    - Implement version comparison logic for "since" filter
    - Return sorted array (timestamp descending)
    - Handle file read errors with 500 status
    - Validate query parameters and return 400 for invalid values
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [ ] 4.2 Add GET /deprecations endpoint to `src/routes/changelog.js`
    - Filter changes where type === "deprecated"
    - Sort by sunsetDate ascending (soonest first)
    - Handle missing sunsetDate values (place at end)
    - Return structured response with schemaVersion
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [ ] 4.3 Register changelog routes in `src/app.js` with feature flag
    - Add ENABLE_CHANGELOG_ENDPOINT environment variable check
    - Conditionally register changelog routes when enabled
    - Add environment variable to .env.example
    - _Requirements: 5.1, 6.1_
  
  - [ ]* 4.4 Write unit tests for changelog REST endpoints
    - Test GET /changelog returns changelog when feature enabled
    - Test GET /changelog returns 404 when feature disabled
    - Test query parameter filtering (since, type, endpoint)
    - Test GET /deprecations returns only deprecated entries
    - Test deprecations sorted by sunset date
    - Test error handling (file not found, invalid JSON)
    - Test invalid query parameter validation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.5_
  
  - [ ]* 4.5 Write property tests for filtering and sorting
    - **Property 8: Changelog endpoint sort order**
    - **Property 9: Changelog filtering correctness**
    - **Property 10: Deprecations endpoint filtering**
    - **Property 11: Deprecations sort order**
    - Generate random changelog datasets with fast-check
    - Test all filter combinations
    - Verify sort orders
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 6.2, 6.5_

- [ ] 5. Create deprecation header middleware
  - [ ] 5.1 Create `src/middleware/deprecation.js` with deprecationHeaders function
    - Implement middleware factory accepting sunsetDate and message parameters
    - Set Deprecation: true header
    - Set Sunset header with formatted UTC date
    - Set Link header pointing to /changelog with rel="deprecation"
    - _Requirements: 7.1_
  
  - [ ] 5.2 Add deprecation consistency validation to `scripts/check-changelog-sync.js`
    - For Change_Entry records with type="deprecated" and affectedEndpoints
    - Load route configuration to check for deprecation middleware
    - Verify sunsetDate in changelog matches Sunset header configuration
    - Report inconsistencies as validation errors
    - _Requirements: 7.5_
  
  - [ ]* 5.3 Write property test for deprecation consistency
    - **Property 17: Deprecation consistency validation**
    - Generate random deprecation entries
    - Verify validation detects mismatches
    - _Requirements: 7.5_

- [ ] 6. Add example integration code to documentation
  - [ ] 6.1 Create `docs/changelog-integration.md` with JavaScript examples
    - Example: Fetch and parse CHANGELOG.json file
    - Example: Query /changelog endpoint with filters
    - Example: Poll /deprecations endpoint
    - Example: Alert on breaking changes
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  
  - [ ] 6.2 Add Python examples to `docs/changelog-integration.md`
    - Python equivalent of all JavaScript examples
    - Use requests library for HTTP calls
    - Include error handling examples
    - _Requirements: 10.5_
  
  - [ ] 6.3 Document commit message format for endpoint annotations
    - Add section to CONTRIBUTING.md or docs
    - Explain endpoint annotation syntax
    - Provide examples for deprecations (Sunset, Removal tags)
    - Explain how annotations become structured changelog entries
    - _Requirements: 2.2_

- [ ] 7. Final checkpoint - Integration testing and documentation
  - [ ] 7.1 Test full workflow end-to-end
    - Create test commits with endpoint annotations
    - Run changelog generation
    - Verify CHANGELOG.json structure
    - Run validation script
    - Test REST endpoints (if enabled)
    - Verify deprecation headers on sample deprecated endpoint
  
  - [ ] 7.2 Update README and API documentation
    - Document new CHANGELOG.json format
    - Link to changelog integration guide
    - Document REST endpoint availability and query parameters
    - Update OpenAPI spec if endpoints are always-on (not feature-flagged)
  
  - [ ] 7.3 Ensure all tests pass
    - Run full test suite: `npm test`
    - Verify no regressions in existing functionality
    - Ensure all property tests run with 100+ iterations

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties across all inputs
- Unit tests validate specific examples and integration points
- The structured changelog enables programmatic consumption while maintaining backward compatibility with human-readable CHANGELOG.md
- REST endpoints are optional (feature-flagged) to allow gradual rollout
- Validation script prevents drift between changelog and codebase

