/**
 * Scope Validator Utility - Authorization Layer
 * 
 * RESPONSIBILITY: Fine-grained permission scope validation and management
 * OWNER: Security Team
 * DEPENDENCIES: None
 * 
 * Provides utilities for validating, checking, and managing permission scopes
 * for API keys. Enables least-privilege access control through granular permissions.
 */

/**
 * Comprehensive list of all available permission scopes
 * Scopes follow the pattern: resource:action
 */
const ALL_SCOPES = Object.freeze([
  // Donations
  'donations:create',
  'donations:read',
  'donations:update',
  'donations:delete',
  'donations:verify',
  
  // Wallets
  'wallets:create',
  'wallets:read',
  'wallets:update',
  'wallets:delete',
  'wallets:export',
  
  // Streams
  'stream:create',
  'stream:read',
  'stream:update',
  'stream:delete',
  
  // Stats & Analytics
  'stats:read',
  'stats:export',
  
  // Transactions
  'transactions:read',
  'transactions:sync',
  'transactions:simulate',
  'transactions:export',
  
  // API Key Management
  'apikeys:create',
  'apikeys:read',
  'apikeys:update',
  'apikeys:rotate',
  'apikeys:revoke',
  
  // Webhooks
  'webhooks:create',
  'webhooks:read',
  'webhooks:update',
  'webhooks:delete',
  
  // Admin actions
  'admin:*',
]);

/**
 * Validate individual scope string
 * @param {string} scope - The scope to validate
 * @returns {boolean} True if scope is valid
 */
function isValidScope(scope) {
  if (typeof scope !== 'string') return false;
  if (!scope.trim()) return false;
  
  return ALL_SCOPES.includes(scope);
}

/**
 * Validate array of scopes
 * @param {Array<string>} scopes - Array of scopes to validate
 * @returns {Object} Result object with valid flag and any errors
 */
function validateScopes(scopes) {
  if (!Array.isArray(scopes)) {
    return {
      valid: false,
      errors: ['Scopes must be an array'],
    };
  }
  
  if (scopes.length === 0) {
    return {
      valid: true,
      scopes: [],
      errors: [],
    };
  }
  
  const errors = [];
  const validScopes = [];
  const duplicates = new Set();
  
  for (const scope of scopes) {
    if (typeof scope !== 'string') {
      errors.push(`Scope must be a string, got ${typeof scope}`);
      continue;
    }
    
    const trimmed = scope.trim();
    
    if (!trimmed) {
      errors.push('Scope cannot be empty string');
      continue;
    }
    
    if (!isValidScope(trimmed)) {
      errors.push(`Invalid scope: "${trimmed}". See documentation for valid scopes.`);
      continue;
    }
    
    if (duplicates.has(trimmed)) {
      errors.push(`Duplicate scope: "${trimmed}"`);
      continue;
    }
    
    duplicates.add(trimmed);
    validScopes.push(trimmed);
  }
  
  return {
    valid: errors.length === 0,
    scopes: validScopes,
    errors,
  };
}

/**
 * Check if key scopes include a specific permission
 * Admin scope '*' or admin:* grants all permissions
 * @param {Array<string>} keyScopes - Scopes assigned to the API key
 * @param {string} requiredScope - The scope/permission being checked
 * @returns {boolean} True if key has the required scope
 */
function hasScope(keyScopes, requiredScope) {
  if (!Array.isArray(keyScopes)) {
    return false;
  }
  
  if (!requiredScope || typeof requiredScope !== 'string') {
    return false;
  }
  
  // Admin wildcard grants all permissions
  if (keyScopes.includes('admin:*')) {
    return true;
  }
  
  // Exact scope match
  if (keyScopes.includes(requiredScope)) {
    return true;
  }
  
  // Wildcard scope match (e.g., 'donations:*' matches 'donations:create')
  const [resource] = requiredScope.split(':');
  if (resource && keyScopes.includes(`${resource}:*`)) {
    return true;
  }
  
  return false;
}

/**
 * Check if key contains all required scopes (AND logic)
 * @param {Array<string>} keyScopes - Scopes assigned to the API key
 * @param {Array<string>} requiredScopes - Required scopes to check
 * @returns {boolean} True if key has all required scopes
 */
function hasAllScopes(keyScopes, requiredScopes) {
  if (!Array.isArray(requiredScopes) || !requiredScopes.length) {
    return true;
  }
  
  return requiredScopes.every(scope => hasScope(keyScopes, scope));
}

/**
 * Check if key contains ANY of the required scopes (OR logic)
 * @param {Array<string>} keyScopes - Scopes assigned to the API key
 * @param {Array<string>} requiredScopes - Required scopes to check
 * @returns {boolean} True if key has at least one required scope
 */
function hasAnyScope(keyScopes, requiredScopes) {
  if (!Array.isArray(requiredScopes) || !requiredScopes.length) {
    return true;
  }
  
  return requiredScopes.some(scope => hasScope(keyScopes, scope));
}

/**
 * Get all available scopes
 * @returns {Array<string>} Array of all valid scopes
 */
function getAllScopes() {
  return [...ALL_SCOPES];
}

/**
 * Get scopes by resource (e.g., 'donations' returns all donation-related scopes)
 * @param {string} resource - Resource name
 * @returns {Array<string>} Array of scopes for the resource
 */
function getScopesByResource(resource) {
  if (!resource || typeof resource !== 'string') {
    return [];
  }
  
  const prefix = `${resource.trim()}:`;
  return ALL_SCOPES.filter(scope => scope.startsWith(prefix));
}

module.exports = {
  ALL_SCOPES,
  isValidScope,
  validateScopes,
  hasScope,
  hasAllScopes,
  hasAnyScope,
  getAllScopes,
  getScopesByResource,
};
