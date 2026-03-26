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

module.exports = {
  registerSchema,
  getSchema,
  registry: schemaRegistry
};
