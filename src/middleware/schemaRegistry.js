/**
 * Schema Version Registry
 * 
 * RESPONSIBILITY: Store and manage request body schemas, versions, and migration guides.
 *
 * Also provides a TRANSFORMATION_TABLE and applyTransformations() so that route
 * handlers can upgrade a request body from one schema version to another using
 * the same rules shared across the application.
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

// ─── Transformation Table ─────────────────────────────────────────────────────

/**
 * Central transformation table.
 *
 * Keys are "fromVersion:toVersion" composite strings.
 * Values are arrays of transformation rule objects, each with:
 *
 *   {
 *     from:       string           – source version
 *     to:         string           – target version
 *     transforms: Array<{
 *       field:         string      – source field name
 *       action:        'rename' | 'default' | 'remove'
 *       newField?:     string      – target field name (used by 'rename')
 *       defaultValue?: *           – value to inject   (used by 'default')
 *     }>
 *   }
 */
const TRANSFORMATION_TABLE = {
  // ── createDonation: v1.0.0 → v2.0.0 ─────────────────────────────────────
  'createDonation:1.0.0:2.0.0': {
    from: '1.0.0',
    to: '2.0.0',
    transforms: [
      { field: 'donor_name',        action: 'rename',  newField: 'donorName' },
      { field: 'recipient_address', action: 'rename',  newField: 'recipient' },
      { field: 'amount_xlm',        action: 'rename',  newField: 'amount' },
      { field: 'currency',          action: 'default', defaultValue: 'XLM' }
    ]
  },

  // ── createWallet: v1.0.0 → v2.0.0 ───────────────────────────────────────
  'createWallet:1.0.0:2.0.0': {
    from: '1.0.0',
    to: '2.0.0',
    transforms: [
      { field: 'public_key', action: 'rename', newField: 'publicKey' }
    ]
  }
};

/**
 * Apply registered transformations to a body, upgrading it from `fromVersion`
 * to `toVersion` for the given schema `key`.
 *
 * Looks up `key:fromVersion:toVersion` in TRANSFORMATION_TABLE.  When no
 * entry is found the body is returned unchanged.  When `fromVersion ===
 * toVersion` the body is also returned unchanged (identity transform).
 *
 * The original body is never mutated — a shallow clone is created first.
 *
 * @param {Object} body         - Request body to transform.
 * @param {string} fromVersion  - Schema version of the incoming body.
 * @param {string} toVersion    - Target schema version.
 * @param {string} [key='']     - Schema key (e.g. 'createDonation').
 * @returns {Object} Transformed body (or original when no rules apply).
 */
function applyTransformations(body, fromVersion, toVersion, key = '') {
  if (!body || typeof body !== 'object') return body;
  if (fromVersion === toVersion) return body;

  const tableKey = key
    ? `${key}:${fromVersion}:${toVersion}`
    : `${fromVersion}:${toVersion}`;

  const entry = TRANSFORMATION_TABLE[tableKey];
  if (!entry || !Array.isArray(entry.transforms) || entry.transforms.length === 0) {
    return body;
  }

  const transformed = Object.assign({}, body);

  for (const rule of entry.transforms) {
    switch (rule.action) {
      case 'rename':
        if (Object.prototype.hasOwnProperty.call(transformed, rule.field)) {
          transformed[rule.newField] = transformed[rule.field];
          delete transformed[rule.field];
        }
        break;

      case 'default':
        if (!Object.prototype.hasOwnProperty.call(transformed, rule.field)) {
          transformed[rule.field] = rule.defaultValue;
        }
        break;

      case 'remove':
        delete transformed[rule.field];
        break;

      default:
        // Unknown action — skip silently
        break;
    }
  }

  return transformed;
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

/**
 * Wallet Creation Schema Versions
 *
 * v1.0.0: Original schema using snake_case field names
 * v2.0.0: Updated schema using camelCase field names with an optional label
 */
registerSchema('createWallet', {
  '1.0.0': {
    body: {
      fields: {
        public_key: {
          type: 'string',
          required: true,
          description: 'Stellar public key (G…)'
        },
        memo: {
          type: 'string',
          required: false,
          description: 'Optional memo associated with the wallet'
        }
      },
      allowUnknown: false
    }
  },
  '2.0.0': {
    body: {
      fields: {
        publicKey: {
          type: 'string',
          required: true,
          description: 'Stellar public key (G…)'
        },
        memo: {
          type: 'string',
          required: false,
          description: 'Optional memo associated with the wallet'
        },
        label: {
          type: 'string',
          required: false,
          description: 'Human-readable label for the wallet'
        }
      },
      allowUnknown: false
    }
  }
}, {
  deprecated: [],
  migrationGuides: {
    '1.0.0': 'Schema v1.0.0 uses snake_case fields. Upgrade to v2.0.0 and rename public_key to publicKey. The new label field is also available in v2.0.0.'
  }
});

module.exports = {
  registerSchema,
  getSchema,
  registry: schemaRegistry,
  applyTransformations,
  TRANSFORMATION_TABLE
};
