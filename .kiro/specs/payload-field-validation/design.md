# Design Document: Payload Field Validation

## Overview

This design implements strict payload validation that rejects requests containing unknown or unexpected fields. The solution extends the existing validation middleware to compare incoming request payloads against defined field schemas, rejecting any requests that contain fields not explicitly allowed for that endpoint.

The implementation follows a defense-in-depth security approach by validating the structure of requests before processing their content. This prevents potential security vulnerabilities from unexpected data fields and reduces the attack surface of the API.

## Architecture

The solution integrates into the existing validation middleware architecture:

```
Request → Validation Middleware → Field Schema Validator → Business Logic
                ↓ (if unknown fields)
          400 Error Response
```

Key architectural decisions:

1. **Schema-First Approach**: Each endpoint defines its allowed fields explicitly
2. **Fail-Fast Validation**: Unknown field detection happens before value validation
3. **Centralized Configuration**: Field schemas are maintained in a single location
4. **Backward Compatible**: Existing valid requests continue to work unchanged

## Components and Interfaces

### 1. Field Schema Registry

A centralized registry that maps endpoints to their allowed field schemas.

```javascript
// Structure
const fieldSchemas = {
  'POST /donations/send': ['senderId', 'receiverId', 'amount', 'memo'],
  'POST /donations': ['amount', 'donor', 'recipient', 'memo'],
  'POST /donations/verify': ['transactionHash'],
  'PATCH /donations/:id/status': ['status', 'stellarTxId', 'ledger'],
  'POST /wallets': ['address', 'label', 'ownerName'],
  'PATCH /wallets/:id': ['label', 'ownerName'],
  'POST /transactions/sync': ['publicKey'],
  'POST /api-keys': ['name', 'role', 'expiresInDays', 'metadata'],
  'POST /api-keys/cleanup': ['retentionDays']
};

// Interface
function getFieldSchema(method, path) {
  // Returns array of allowed field names for the endpoint
  // Returns null if no schema defined (no validation)
}
```

### 2. Unknown Field Detector

A utility function that compares request payload fields against the allowed schema.

```javascript
// Interface
function detectUnknownFields(payload, allowedFields) {
  // Input: payload (object), allowedFields (array of strings)
  // Output: array of unknown field names (empty if all valid)
  // Logic: Returns keys in payload that are not in allowedFields
}
```

### 3. Validation Middleware Enhancement

The existing validation middleware is enhanced to include unknown field detection.

```javascript
// Enhanced middleware flow
function validateRequest(req, res, next) {
  // 1. Get field schema for current endpoint
  const schema = getFieldSchema(req.method, req.route.path);
  
  // 2. If schema exists, check for unknown fields
  if (schema) {
    const unknownFields = detectUnknownFields(req.body, schema);
    
    // 3. If unknown fields found, reject request
    if (unknownFields.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Request contains unknown fields',
        unknownFields: unknownFields
      });
    }
  }
  
  // 4. Continue with existing validation (required fields, value validation)
  // ... existing validation logic ...
  
  next();
}
```

### 4. Error Response Formatter

Formats validation errors consistently with existing error responses.

```javascript
// Interface
function formatUnknownFieldError(unknownFields) {
  // Input: array of unknown field names
  // Output: standardized error response object
  return {
    error: 'Validation failed',
    message: 'Request contains unknown fields',
    unknownFields: unknownFields
  };
}
```

## Data Models

### Field Schema Entry

```javascript
{
  endpoint: String,        // Format: "METHOD /path"
  allowedFields: [String]  // Array of allowed field names
}
```

### Validation Error Response

```javascript
{
  error: String,           // "Validation failed"
  message: String,         // Descriptive error message
  unknownFields: [String]  // Array of field names that are not allowed
}
```

### Request Context

```javascript
{
  method: String,          // HTTP method (POST, PATCH, PUT)
  path: String,            // Route path with parameters
  body: Object             // Request payload to validate
}
```

## Correctness Properties


A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property 1: Unknown Field Detection Completeness

*For any* request payload and field schema, all fields in the payload that are not present in the schema should be identified as unknown fields, regardless of their position or quantity in the payload.

**Validates: Requirements 2.2, 2.3, 2.4**

### Property 2: Request Rejection on Unknown Fields

*For any* request payload containing one or more unknown fields, the validation middleware should reject the request with HTTP status code 400 and prevent business logic execution.

**Validates: Requirements 3.1, 3.2**

### Property 3: Valid Request Acceptance

*For any* request payload containing only allowed fields (as defined in the field schema), the validation middleware should allow the request to proceed to business logic.

**Validates: Requirements 3.3**

### Property 4: Error Response Completeness

*For any* request rejected due to unknown fields, the validation error response should include all detected unknown field names in the response body.

**Validates: Requirements 4.1, 4.2**

### Property 5: Backward Compatibility Preservation

*For any* request payload that contains only fields that were previously accepted by the system, the validation middleware should process the request successfully without rejection.

**Validates: Requirements 5.1, 5.2**

### Property 6: Field Schema Comparison

*For any* request payload and field schema, when the validation middleware compares the payload against the schema, it should examine all fields present in the payload.

**Validates: Requirements 2.1**

## Error Handling

### Unknown Field Errors

When unknown fields are detected:
- Return HTTP 400 Bad Request
- Include error object with:
  - `error`: "Validation failed"
  - `message`: "Request contains unknown fields"
  - `unknownFields`: Array of unknown field names
- Do not execute business logic
- Log the validation failure for security monitoring

### Schema Not Found

When no field schema is defined for an endpoint:
- Skip unknown field validation
- Continue with existing validation logic
- This allows gradual rollout and backward compatibility

### Empty Payload

When request body is empty or null:
- Skip unknown field validation (no fields to validate)
- Continue with existing required field validation
- Existing validation will catch missing required fields

### Malformed JSON

When request body is not valid JSON:
- Express body parser will handle this before validation middleware
- Return 400 error from body parser
- Validation middleware will not be reached

## Testing Strategy

### Dual Testing Approach

This feature requires both unit tests and property-based tests for comprehensive coverage:

- **Unit tests**: Verify specific endpoint schemas, error message formats, and integration with existing validation
- **Property tests**: Verify universal properties across all possible payloads and field combinations

### Property-Based Testing

We will use **fast-check** (JavaScript property-based testing library) to implement property tests.

**Configuration**:
- Minimum 100 iterations per property test
- Each test references its design document property
- Tag format: `Feature: payload-field-validation, Property {number}: {property_text}`

**Property Test Coverage**:
1. Unknown field detection across random payloads
2. Request rejection behavior with various unknown field combinations
3. Valid request acceptance with random valid payloads
4. Error response completeness with random unknown fields
5. Backward compatibility with previously valid payloads

### Unit Testing

**Focus areas**:
- Specific endpoint schema definitions (POST /donations/send, etc.)
- Error response format matches existing validation errors
- Integration with existing validation middleware
- Edge cases: empty payloads, null values, nested objects
- HTTP method filtering (POST/PATCH/PUT only)

**Example unit tests**:
- Test that POST /donations/send rejects payload with extra field "hacker"
- Test that error response includes all unknown fields
- Test that valid payload for POST /wallets passes validation
- Test that GET requests skip unknown field validation
- Test that existing required field validation still works

### Integration Testing

- Test validation middleware in full request/response cycle
- Verify business logic is not executed when validation fails
- Verify existing valid clients continue to work
- Test interaction with existing validation rules

### Test Data

Use realistic field names and values:
- Valid fields from actual endpoint schemas
- Common typos and variations (e.g., "ammount" instead of "amount")
- Malicious-looking fields (e.g., "__proto__", "constructor")
- Nested object fields
- Array fields
