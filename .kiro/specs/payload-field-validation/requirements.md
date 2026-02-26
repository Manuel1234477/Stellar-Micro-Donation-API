# Requirements Document

## Introduction

This document specifies requirements for implementing strict payload validation that rejects unexpected fields in request payloads for a Node.js/Express API serving a Stellar blockchain donation platform. The system currently validates required fields and field values but does not reject extra/unknown fields, creating a security risk and potential attack surface.

## Glossary

- **Validation_Middleware**: The Express middleware component responsible for validating incoming request payloads
- **Request_Payload**: The JSON body of an HTTP request containing data submitted by the client
- **Allowed_Field**: A field explicitly defined in the endpoint's schema as acceptable input
- **Unknown_Field**: A field present in the request payload that is not defined in the endpoint's allowed field schema
- **Field_Schema**: A specification defining the complete set of allowed fields for a specific endpoint
- **Validation_Error**: An error response indicating which fields in the request are not allowed

## Requirements

### Requirement 1: Field Schema Definition

**User Story:** As a developer, I want to define allowed fields for each endpoint, so that the validation system knows which fields to accept and which to reject.

#### Acceptance Criteria

1. THE Validation_Middleware SHALL maintain a Field_Schema for each endpoint that accepts Request_Payloads
2. WHEN a Field_Schema is defined, THE Validation_Middleware SHALL include all currently accepted fields for backward compatibility
3. THE Field_Schema SHALL specify allowed fields for POST /donations/send endpoint (senderId, receiverId, amount, memo)
4. THE Field_Schema SHALL specify allowed fields for POST /donations endpoint (amount, donor, recipient, memo)
5. THE Field_Schema SHALL specify allowed fields for POST /donations/verify endpoint (transactionHash)
6. THE Field_Schema SHALL specify allowed fields for PATCH /donations/:id/status endpoint (status, stellarTxId, ledger)
7. THE Field_Schema SHALL specify allowed fields for POST /wallets endpoint (address, label, ownerName)
8. THE Field_Schema SHALL specify allowed fields for PATCH /wallets/:id endpoint (label, ownerName)
9. THE Field_Schema SHALL specify allowed fields for POST /transactions/sync endpoint (publicKey)
10. THE Field_Schema SHALL specify allowed fields for POST /api-keys endpoint (name, role, expiresInDays, metadata)
11. THE Field_Schema SHALL specify allowed fields for POST /api-keys/cleanup endpoint (retentionDays)

### Requirement 2: Unknown Field Detection

**User Story:** As a security engineer, I want the system to detect unknown fields in request payloads, so that potentially malicious or erroneous data is identified before processing.

#### Acceptance Criteria

1. WHEN a Request_Payload is received, THE Validation_Middleware SHALL compare all fields in the payload against the Field_Schema
2. WHEN a field in the Request_Payload is not present in the Field_Schema, THE Validation_Middleware SHALL identify it as an Unknown_Field
3. THE Validation_Middleware SHALL detect Unknown_Fields regardless of their position in the Request_Payload
4. THE Validation_Middleware SHALL detect multiple Unknown_Fields when present in a single Request_Payload

### Requirement 3: Request Rejection

**User Story:** As a security engineer, I want requests with unknown fields to be rejected, so that the attack surface is minimized and data integrity is maintained.

#### Acceptance Criteria

1. WHEN one or more Unknown_Fields are detected, THE Validation_Middleware SHALL reject the request with HTTP status code 400
2. WHEN a request is rejected, THE Validation_Middleware SHALL prevent execution of business logic
3. WHEN a Request_Payload contains only Allowed_Fields, THE Validation_Middleware SHALL allow the request to proceed
4. THE Validation_Middleware SHALL execute unknown field validation before business logic execution

### Requirement 4: Error Response Format

**User Story:** As a client developer, I want clear error messages when my request is rejected, so that I can quickly identify and fix the issue.

#### Acceptance Criteria

1. WHEN a request is rejected due to Unknown_Fields, THE Validation_Middleware SHALL return a Validation_Error response
2. THE Validation_Error SHALL include a list of all Unknown_Fields detected in the Request_Payload
3. THE Validation_Error SHALL maintain consistency with existing validation error response format
4. THE Validation_Error SHALL include a descriptive message indicating that unknown fields are not allowed
5. THE Validation_Error SHALL be structured as JSON for programmatic parsing

### Requirement 5: Backward Compatibility

**User Story:** As a system administrator, I want existing valid clients to continue working without changes, so that the security enhancement does not disrupt current operations.

#### Acceptance Criteria

1. WHEN a Request_Payload contains only fields that were previously accepted, THE Validation_Middleware SHALL process the request successfully
2. THE Validation_Middleware SHALL not reject requests that would have been accepted before the implementation
3. WHEN existing validation rules detect errors, THE Validation_Middleware SHALL maintain the existing error response format
4. THE Validation_Middleware SHALL preserve existing validation behavior for required fields and value validation

### Requirement 6: Comprehensive Endpoint Coverage

**User Story:** As a security engineer, I want all endpoints that accept request bodies to have strict field validation, so that the entire API surface is protected.

#### Acceptance Criteria

1. THE Validation_Middleware SHALL apply unknown field validation to all POST endpoints that accept Request_Payloads
2. THE Validation_Middleware SHALL apply unknown field validation to all PUT endpoints that accept Request_Payloads
3. THE Validation_Middleware SHALL apply unknown field validation to all PATCH endpoints that accept Request_Payloads
4. THE Validation_Middleware SHALL not apply unknown field validation to GET endpoints
5. THE Validation_Middleware SHALL not apply unknown field validation to DELETE endpoints without request bodies
