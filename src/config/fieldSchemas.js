/**
 * Field Schema Registry - Payload Validation Configuration
 * 
 * RESPONSIBILITY: Define allowed fields for each API endpoint
 * OWNER: Security Team
 * DEPENDENCIES: None
 * 
 * Centralized registry of allowed request body fields for strict payload validation.
 * Each endpoint that accepts request bodies must have its allowed fields defined here.
 * Unknown fields not in the schema will be rejected with a 400 error.
 */

/**
 * Field schemas mapped by endpoint pattern
 * Format: 'METHOD /path' => ['field1', 'field2', ...]
 * 
 * Path parameters (e.g., :id) should be included in the pattern
 */
const fieldSchemas = {
  // Donation endpoints
  'POST /donations/send': ['senderId', 'receiverId', 'amount', 'memo'],
  'POST /donations': ['amount', 'donor', 'recipient', 'memo'],
  'POST /donations/verify': ['transactionHash'],
  'PATCH /donations/:id/status': ['status', 'stellarTxId', 'ledger'],

  // Wallet endpoints
  'POST /wallets': ['address', 'label', 'ownerName'],
  'PATCH /wallets/:id': ['label', 'ownerName'],

  // Transaction endpoints
  'POST /transactions/sync': ['publicKey'],

  // API Key endpoints
  'POST /api-keys': ['name', 'role', 'expiresInDays', 'metadata'],
  'POST /api-keys/cleanup': ['retentionDays']
};

/**
 * Get the field schema for a specific endpoint
 * @param {string} method - HTTP method (GET, POST, PUT, PATCH, DELETE)
 * @param {string} path - Route path (e.g., '/donations/send' or '/donations/:id/status')
 * @returns {string[]|null} Array of allowed field names, or null if no schema defined
 */
function getFieldSchema(method, path) {
  if (!method || !path) {
    return null;
  }

  // Normalize method to uppercase
  const normalizedMethod = method.toUpperCase();

  // Try exact match first
  const exactKey = `${normalizedMethod} ${path}`;
  if (fieldSchemas[exactKey]) {
    return fieldSchemas[exactKey];
  }

  // Try to match with path parameters
  // Convert actual path like '/donations/123/status' to pattern '/donations/:id/status'
  for (const [schemaKey, fields] of Object.entries(fieldSchemas)) {
    const [schemaMethod, schemaPath] = schemaKey.split(' ');
    
    if (schemaMethod !== normalizedMethod) {
      continue;
    }

    // Convert schema path pattern to regex
    // Replace :param with regex pattern that matches any value
    const pathPattern = schemaPath.replace(/:[^/]+/g, '[^/]+');
    const regex = new RegExp(`^${pathPattern}$`);

    if (regex.test(path)) {
      return fields;
    }
  }

  // No schema found for this endpoint
  return null;
}

/**
 * Check if a schema exists for the given endpoint
 * @param {string} method - HTTP method
 * @param {string} path - Route path
 * @returns {boolean} True if schema exists, false otherwise
 */
function hasFieldSchema(method, path) {
  return getFieldSchema(method, path) !== null;
}

/**
 * Get all registered endpoint patterns
 * @returns {string[]} Array of endpoint patterns (e.g., 'POST /donations')
 */
function getAllEndpointPatterns() {
  return Object.keys(fieldSchemas);
}

module.exports = {
  getFieldSchema,
  hasFieldSchema,
  getAllEndpointPatterns,
  fieldSchemas // Export for testing purposes
};
