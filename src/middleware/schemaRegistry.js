/**
 * Schema Version Registry
 * 
 * RESPONSIBILITY: Store and manage request body schemas, versions, and migration guides.
 */

const schemaRegistry = new Map();

/**
 * Register a schema with multiple versions in the central registry.
 * 
 * Sorts versions using a simple semver-like logic (major.minor.patch) to identify 'latest'.
 * 
 * @param {string} key Unique identifier for the schema (e.g., 'createDonation').
 * @param {Object} versions Object mapping version strings (e.g. '1.0.0') to schema objects.
 * @param {Object} options Configuration options.
 * @param {string[]} [options.deprecated=[]] List of deprecated version strings.
 * @param {Object} [options.migrationGuides={}] Object mapping version strings to migration guidance messages.
 */
function registerSchema(key, versions, options = {}) {
  const { deprecated = [], migrationGuides = {} } = options;
  
  const sortedVersions = Object.keys(versions).sort((a, b) => {
    // Simple semver-like sorting (major.minor.patch)
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return -1;
      if ((pa[i] || 0) < (pb[i] || 0)) return 1;
    }
    return 0;
  });

  schemaRegistry.set(key, {
    versions,
    latest: sortedVersions[0],
    allVersions: sortedVersions,
    deprecated,
    migrationGuides
  });
}

/**
 * Retrieve a schema by key and version
 * @param {string} key Schema identifier
 * @param {string} version Requested version (optional, defaults to latest)
 * @returns {Object|null} Schema information object or null if not found
 */
function getSchema(key, version) {
  const entry = schemaRegistry.get(key);
  if (!entry) return null;

  const requestedVersion = version || entry.latest;
  const schema = entry.versions[requestedVersion];

  if (!schema) return null;

  return {
    schema,
    version: requestedVersion,
    isLatest: requestedVersion === entry.latest,
    isDeprecated: entry.deprecated.includes(requestedVersion),
    migrationGuide: entry.migrationGuides[requestedVersion] || null,
    supportedVersions: entry.allVersions
  };
}

// ─── Built-in Schema Registrations ───────────────────────────────────────────

/**
 * Donation Creation Schema Versions
 * 
 * v1.0.0: Original schema with basic donation fields
 * v2.0.0: Enhanced schema with currency support and additional metadata
 */
registerSchema('createDonation', {
  '1.0.0': {
    body: {
      fields: {
        amount: {
          type: 'number',
          required: true,
          min: 0.0000001,
          max: 922337203685.4775,
          description: 'Donation amount in XLM'
        },
        recipient: {
          type: 'string',
          required: true,
          minLength: 56,
          maxLength: 56,
          pattern: /^G[A-Z2-7]{55}$/,
          description: 'Stellar public key of the recipient'
        },
        memo: {
          type: 'string',
          required: false,
          maxLength: 28,
          description: 'Optional memo for the transaction'
        },
        idempotencyKey: {
          type: 'string',
          required: false,
          minLength: 1,
          maxLength: 255,
          description: 'Idempotency key for request deduplication'
        }
      },
      allowUnknown: false
    }
  },
  '2.0.0': {
    body: {
      fields: {
        amount: {
          type: 'number',
          required: true,
          min: 0.0000001,
          max: 922337203685.4775,
          description: 'Donation amount in the specified currency'
        },
        recipient: {
          type: 'string',
          required: true,
          minLength: 56,
          maxLength: 56,
          pattern: /^G[A-Z2-7]{55}$/,
          description: 'Stellar public key of the recipient'
        },
        currency: {
          type: 'string',
          required: true,
          enum: ['XLM', 'USDC'],
          description: 'Currency code for the donation'
        },
        memo: {
          type: 'string',
          required: false,
          maxLength: 28,
          description: 'Optional memo for the transaction'
        },
        idempotencyKey: {
          type: 'string',
          required: false,
          minLength: 1,
          maxLength: 255,
          description: 'Idempotency key for request deduplication'
        },
        metadata: {
          type: 'object',
          required: false,
          description: 'Optional metadata object for additional context'
        }
      },
      allowUnknown: false
    }
  }
}, {
  deprecated: [],
  migrationGuides: {
    '1.0.0': 'Schema v1.0.0 is supported but v2.0.0 is recommended. Upgrade to v2.0.0 to specify currency (XLM or USDC) and include optional metadata.'
  }
});

module.exports = {
  registerSchema,
  getSchema,
  registry: schemaRegistry
};
