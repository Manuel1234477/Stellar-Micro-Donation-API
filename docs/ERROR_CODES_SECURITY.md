# Error Code Security Documentation

## Overview

This document outlines the security measures implemented to prevent error code enumeration attacks and information leakage in the Stellar Micro-Donation API.

## Security Principles

### 1. Structured Error Codes with Numeric IDs

All error codes follow a structured format with both string codes and numeric IDs:

```javascript
{
  code: 'VALIDATION_ERROR',    // Human-readable string
  numeric: 1000               // Stable numeric ID for API consumers
}
```

### 2. Numeric Code Ranges

Error codes are organized into logical ranges to prevent enumeration:

- **1000-1099**: Validation errors
- **2000-2099**: Authentication/Authorization errors  
- **3000-3099**: Not found errors
- **4000-4099**: Conflict/Duplicate errors
- **5000-5099**: Business logic errors
- **6000-6099**: Rate limiting errors
- **7000-7099**: Stellar/Blockchain errors
- **8000-8099**: Network/Infrastructure errors
- **9000-9099**: Internal server errors

### 3. Environment-Based Message Sanitization

Error messages are sanitized based on the environment:

#### Production Environment
- Generic error messages that don't reveal internal structure
- No field enumeration details
- No constraint values (limits, thresholds)
- No internal timestamps or identifiers
- No database schema information

#### Development Environment
- Detailed error messages for debugging
- Field validation details
- Constraint values and limits
- Full error context

## Implementation Details

### Error Code Registry

All error codes are centrally defined in `src/utils/errors.js`:

```javascript
const ERROR_CODES = {
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', numeric: 1000 },
  UNAUTHORIZED: { code: 'UNAUTHORIZED', numeric: 2000 },
  NOT_FOUND: { code: 'NOT_FOUND', numeric: 3000 },
  // ... etc
};
```

### Production Message Examples

| Error Type | Production Message | Development Message |
|------------|-------------------|-------------------|
| Unknown Fields | "Request contains unknown or unexpected fields" | "Request contains unknown fields: ['hacker']. Allowed: ['amount', 'donor']" |
| Amount Validation | "Amount is below the minimum allowed" | "Amount must be at least 0.1 XLM" |
| Rate Limiting | "Rate limit exceeded. Please try again later" | "Rate limit exceeded. Limit: 100/hour, resets at: 2024-01-01T12:00:00Z" |
| Stellar Errors | "Service temporarily unavailable" | "Unable to connect to Stellar network (ECONNREFUSED)" |

### Security Features

#### 1. Field Enumeration Prevention
- No `allowedFields` arrays in production responses
- No `unknownFields` details in production
- Generic validation error messages

#### 2. Rate Limit Information Hiding
- No rate limit values exposed in production
- No reset timestamps in production
- Prevents timing attack vectors

#### 3. Infrastructure Information Hiding
- Network errors mapped to generic "service unavailable"
- No database error details
- No file paths or internal structure

#### 4. Stellar Network Error Sanitization
- All Stellar SDK errors mapped to generic codes
- No network topology information
- No infrastructure details

## Error Response Format

### Standard Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "numericCode": 1000,
    "message": "Invalid request format",
    "requestId": "req_123456789",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

### Production vs Development

#### Production Response
```json
{
  "success": false,
  "error": {
    "code": "UNKNOWN_FIELDS",
    "numericCode": 1010,
    "message": "Request contains unknown or unexpected fields",
    "requestId": "req_123456789",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

#### Development Response
```json
{
  "success": false,
  "error": {
    "code": "UNKNOWN_FIELDS",
    "numericCode": 1010,
    "message": "Request contains unknown or unexpected fields",
    "unknownFields": ["hacker", "malicious"],
    "allowedFields": ["amount", "donor", "recipient"],
    "requestId": "req_123456789",
    "timestamp": "2024-01-01T12:00:00.000Z"
  }
}
```

## Security Testing

### Enumeration Attack Prevention

The following attack vectors are prevented:

1. **Field Enumeration**: Attackers cannot discover valid field names through error responses
2. **Constraint Discovery**: Rate limits, amount limits, and other constraints are hidden
3. **Infrastructure Mapping**: Network topology and internal services are not exposed
4. **Timing Attacks**: Rate limit reset times and precise timestamps are hidden

### Validation

To validate security measures:

1. Set `NODE_ENV=production`
2. Send requests with invalid fields
3. Verify no field enumeration details are returned
4. Test rate limiting without exposing limits
5. Trigger Stellar errors and verify generic responses

## Best Practices

### For Developers

1. Always use centralized ERROR_CODES constants
2. Never hardcode error messages in production
3. Use environment checks before exposing sensitive details
4. Log detailed errors internally but return generic messages to clients

### For API Consumers

1. Use numeric error codes for stable error handling
2. Don't rely on error message text for logic
3. Implement proper retry logic for rate limiting
4. Handle generic error messages gracefully

## Compliance

This implementation ensures:

- **OWASP Compliance**: Prevents information disclosure through error messages
- **Security Best Practices**: No enumeration attack vectors
- **Stable API**: Numeric codes provide consistent error handling
- **Developer Experience**: Detailed errors in development, secure in production