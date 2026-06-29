# Requirements Document

## Introduction

This document specifies requirements for a machine-readable API changelog and deprecation feed. Currently, the system generates human-readable changelog content from conventional commits via `scripts/generate-changelog.js`, but this prose-based format in `CHANGELOG.md` cannot be consumed programmatically by integrators' tooling. This feature introduces a structured, machine-readable changelog format (JSON) that captures change type, affected endpoints, version information, and descriptions, enabling integrators to build automated alerts for breaking changes and deprecations. The structured changelog will be kept in sync via CI and optionally exposed through REST endpoints for programmatic access.

## Glossary

- **Structured_Changelog**: A machine-readable JSON file containing an array of change entries with type, version, affected endpoints, and description
- **Change_Entry**: A single record in the Structured_Changelog representing one API change with fields: version, type, affectedEndpoints, description, timestamp, and commitHash
- **Change_Type**: One of: "added", "changed", "deprecated", "removed", "fixed", "security"
- **Affected_Endpoint**: An API endpoint path and HTTP method impacted by a change (e.g., "POST /donations", "GET /wallets/:id")
- **Deprecation_Entry**: A Change_Entry with type "deprecated" that signals an endpoint or feature will be removed in a future version
- **Changelog_Generator**: The script or CI process that parses conventional commits and generates both human-readable and structured changelog formats
- **Changelog_Endpoint**: An optional REST API endpoint (e.g., `/changelog`) that serves the Structured_Changelog for programmatic consumption
- **Deprecations_Endpoint**: An optional REST API endpoint (e.g., `/deprecations`) that serves only Change_Entry records with type "deprecated"
- **Sunset_Header**: The HTTP Sunset header specified in RFC 8594 indicating when an endpoint will be deprecated
- **Deprecation_Header**: The HTTP Deprecation header indicating an endpoint is deprecated

## Requirements

### Requirement 1: Generate Structured Changelog from Conventional Commits

**User Story:** As an integrator, I want the system to produce a machine-readable changelog alongside the human-readable version, so that I can programmatically detect changes affecting my integration without manual parsing.

#### Acceptance Criteria

1. WHEN the Changelog_Generator runs, THE System SHALL produce a Structured_Changelog file in JSON format
2. THE System SHALL parse conventional commits to extract Change_Type, description, and commitHash for each Change_Entry
3. WHEN a conventional commit includes breaking change indicators (BREAKING CHANGE in body or "!" after type), THE System SHALL mark the Change_Entry with isBreaking: true
4. THE System SHALL write the Structured_Changelog to a well-known file path (e.g., `CHANGELOG.json` or `docs/changelog.json`)
5. THE Changelog_Generator SHALL maintain both human-readable (`CHANGELOG.md`) and Structured_Changelog outputs simultaneously

### Requirement 2: Capture Affected Endpoints in Change Entries

**User Story:** As an integrator, I want each changelog entry to specify which API endpoints are affected, so that I can filter changes relevant to the endpoints I actually use and ignore unrelated changes.

#### Acceptance Criteria

1. THE System SHALL include an affectedEndpoints array field in each Change_Entry
2. WHEN a conventional commit message includes endpoint annotations (e.g., via commit body tags or scope), THE System SHALL extract Affected_Endpoint values
3. THE System SHALL represent each Affected_Endpoint as an object with method (HTTP verb) and path (endpoint path) fields
4. WHEN no endpoints are explicitly specified in a commit, THE System SHALL set affectedEndpoints to an empty array
5. THE System SHALL support multiple Affected_Endpoint entries within a single Change_Entry

### Requirement 3: Include Essential Metadata in Change Entries

**User Story:** As an integrator building automated tooling, I want each changelog entry to include version, timestamp, and commit hash, so that I can trace changes back to source control and align them with release schedules.

#### Acceptance Criteria

1. THE System SHALL include a version field in each Change_Entry indicating the release version where the change was introduced
2. THE System SHALL include a timestamp field in each Change_Entry in ISO 8601 format (UTC)
3. THE System SHALL include a commitHash field in each Change_Entry with the full git commit SHA
4. THE System SHALL include a type field in each Change_Entry using one of the standardized Change_Type values
5. THE System SHALL include a description field in each Change_Entry containing the human-readable change summary

### Requirement 4: Maintain Structured Changelog via CI

**User Story:** As a developer, I want the structured changelog to be automatically validated and updated during the release process, so that it never drifts out of sync with the actual codebase or release tags.

#### Acceptance Criteria

1. WHEN a release is tagged in CI, THE System SHALL regenerate the Structured_Changelog to include all changes since the previous release
2. THE System SHALL fail the CI pipeline IF the Structured_Changelog is out of sync with the git commit history
3. THE System SHALL commit and push the updated Structured_Changelog as part of the automated release workflow
4. THE System SHALL prevent manual edits to the Structured_Changelog from bypassing validation
5. THE System SHALL maintain a complete history of all changes across all versions in the Structured_Changelog

### Requirement 5: Expose Structured Changelog via REST Endpoint

**User Story:** As an integrator, I want to poll a `/changelog` endpoint to retrieve the structured changelog programmatically, so that I can check for updates without cloning the repository or parsing markdown files.

#### Acceptance Criteria

1. WHERE the Changelog_Endpoint feature is enabled, THE System SHALL expose a `GET /changelog` endpoint returning the Structured_Changelog as JSON
2. THE Changelog_Endpoint SHALL return an array of Change_Entry objects sorted by timestamp descending (newest first)
3. THE Changelog_Endpoint SHALL support optional query parameters: `?since={version}` to retrieve only changes after a specific version
4. THE Changelog_Endpoint SHALL support optional query parameters: `?type={Change_Type}` to filter by change type
5. THE Changelog_Endpoint SHALL support optional query parameters: `?endpoint={path}` to filter by Affected_Endpoint path

### Requirement 6: Expose Deprecation Feed via REST Endpoint

**User Story:** As an integrator, I want to poll a `/deprecations` endpoint to retrieve only deprecated features and endpoints, so that I can prioritize migration work and avoid using soon-to-be-removed functionality.

#### Acceptance Criteria

1. WHERE the Deprecations_Endpoint feature is enabled, THE System SHALL expose a `GET /deprecations` endpoint returning only Deprecation_Entry records
2. THE Deprecations_Endpoint SHALL return an array of Change_Entry objects where type equals "deprecated"
3. THE Deprecations_Endpoint SHALL include sunsetDate field in each Deprecation_Entry indicating when the feature will be removed (if known)
4. THE Deprecations_Endpoint SHALL include removalVersion field in each Deprecation_Entry indicating the version where removal is planned (if known)
5. THE Deprecations_Endpoint SHALL sort results by sunsetDate ascending (soonest deprecations first)

### Requirement 7: Cross-Reference with Deprecation/Sunset Headers

**User Story:** As an integrator, I want deprecation changelog entries to align with the Deprecation and Sunset HTTP headers returned by deprecated endpoints, so that I receive consistent signals across all touchpoints.

#### Acceptance Criteria

1. WHEN a Change_Entry has type "deprecated" and includes an Affected_Endpoint, THE System SHALL ensure the endpoint emits Deprecation_Header and Sunset_Header
2. THE System SHALL ensure the sunsetDate value in the Deprecation_Entry matches the Sunset_Header value for the corresponding endpoint
3. THE System SHALL ensure deprecation announcements in the Structured_Changelog precede the actual Sunset_Header enforcement
4. THE System SHALL document the relationship between changelog deprecation entries and response headers in the API documentation
5. THE System SHALL validate consistency between Structured_Changelog deprecation records and endpoint header configuration during CI

### Requirement 8: Support Versioned Changelog Schema

**User Story:** As a system maintainer, I want the structured changelog format to include a schema version, so that future enhancements to the changelog structure do not break existing integrators' parsers.

#### Acceptance Criteria

1. THE Structured_Changelog SHALL include a schemaVersion field at the root level indicating the changelog format version
2. THE System SHALL use semantic versioning for the schemaVersion field (e.g., "1.0.0")
3. WHEN the structure of Change_Entry fields changes in a backward-incompatible way, THE System SHALL increment the schemaVersion major version
4. THE System SHALL document the changelog schema structure and all schema versions in the API documentation
5. THE System SHALL validate generated Structured_Changelog files against the declared schemaVersion during CI

### Requirement 9: Validate Endpoint References in Changelog Entries

**User Story:** As a developer, I want the system to validate that endpoints referenced in changelog entries actually exist in the OpenAPI spec, so that the structured changelog does not contain stale or incorrect endpoint references.

#### Acceptance Criteria

1. WHEN a Change_Entry includes an Affected_Endpoint, THE System SHALL verify the endpoint exists in the current OpenAPI specification
2. THE System SHALL fail CI validation IF a Change_Entry references a non-existent endpoint path or method combination
3. THE System SHALL allow Affected_Endpoint references to endpoints that existed in previous versions but were removed (for "removed" type entries)
4. THE System SHALL generate a validation report listing any orphaned or invalid endpoint references
5. THE System SHALL skip endpoint validation for Change_Entry records with type "docs", "test", "chore", or "ci"

### Requirement 10: Provide Example Integration Code

**User Story:** As an integrator, I want example code demonstrating how to consume the structured changelog and deprecation feed, so that I can quickly implement automated alerts without trial and error.

#### Acceptance Criteria

1. THE System SHALL provide example code in the documentation showing how to fetch and parse the Structured_Changelog file
2. THE System SHALL provide example code demonstrating how to query the Changelog_Endpoint with filters
3. THE System SHALL provide example code demonstrating how to poll the Deprecations_Endpoint and detect new deprecations
4. THE System SHALL provide example code demonstrating how to alert on breaking changes or specific Change_Type values
5. THE System SHALL include examples in at least two common languages (e.g., JavaScript/Node.js and Python)

