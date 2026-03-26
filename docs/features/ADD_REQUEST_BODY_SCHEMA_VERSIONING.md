# Request Body Schema Versioning

## Overview
As the Stellar Micro-Donation API evolves, request body schemas may change. Schema versioning allows the API to accept multiple schema versions simultaneously and provide clear upgrade paths for clients.

## Key Features
- **Version Negotiation**: Clients can specify the desired schema version using the `X-Schema-Version` request header (e.g., `1.0.0`).
- **Default Versioning**: If no version is specified, the latest stable version is used.
- **Deprecation Warnings**: Usage of older schemas triggers deprecation headers and standard warning messages.
- **Migration Guides**: Clients using deprecated or invalid versions receive actionable migration guidance.

## Header Support
### Request Headers
- `X-Schema-Version`: (Optional) The version of the schema to validate against (e.g., `1.0.0`).

### Response Headers
- `X-Schema-Version`: The version of the schema actually used.
- `X-Schema-Version-Supported`: A list of all supported schema versions for the requested endpoint.
- `X-Schema-Deprecated`: `true` if the requested version is deprecated.
- `X-Schema-Migration-Guide`: A message describing how to migrate to the latest version.
- `Warning`: A standard HTTP warning header (199) containing deprecation details.

## Implementation Details

### Registry
Schemas are stored in a central `schemaRegistry.js` which manages versions, deprecation status, and migration guides.

### Middleware
The `schemaValidation.js` middleware handles the version negotiation and validation logic.

#### Example Usage in Routes
```javascript
const { validateSchema } = require('../middleware/schemaValidation');

const mySchemaVersions = {
  '1.0.0': { 
    body: { 
      fields: { 
        amount: { type: 'number', required: true } 
      } 
    } 
  },
  '2.0.0': { 
    body: { 
      fields: { 
        amount: { type: 'number', required: true },
        currency: { type: 'string', required: true }
      } 
    } 
  }
};

const myOptions = {
  deprecated: ['1.0.0'],
  migrationGuides: {
    '1.0.0': 'Upgrade to 2.0.0 to support multiple currencies.'
  }
};

router.post('/my-endpoint', validateSchema('myEndpointName', mySchemaVersions, myOptions), (req, res) => {
  // Handle request
});
```

## Security Assumptions
- Schema versioning is for structure validation only and does not bypass authentication or authorization.
- Version negotiation is performed before processing sensitive data.

## Error Handling
When validation fails, or an unsupported version is requested, the API returns a `400 Bad Request` with:
- `code`: `VALIDATION_ERROR` or `INVALID_SCHEMA_VERSION`
- `supportedVersions`: List of valid versions for the endpoint
- `migrationGuide`: Instructions on how to upgrade (if applicable)
