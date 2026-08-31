#!/usr/bin/env node

/**
 * CLI utility for managing API keys
 * Usage:
 *   node src/scripts/manageApiKeys.js create --name "My Key" --role user --expires 90
 *   node src/scripts/manageApiKeys.js list
 *   node src/scripts/manageApiKeys.js deprecate --id 1
 *   node src/scripts/manageApiKeys.js revoke --id 1
 *   node src/scripts/manageApiKeys.js cleanup --retention 90
 */

// External modules
require('dotenv').config();

// Internal modules
const apiKeysModel = require('../models/apiKeys');
const { initializeApiKeysTable } = require('../models/apiKeys');

const commands = {
  create: async (args) => {
    const name = args.name;
    const role = args.role || 'user';
    const expiresInDays = args.expires ? parseInt(args.expires, 10) : undefined;
    const allowedIps = args['allowed-ips']
      ? args['allowed-ips'].split(',').map(ip => ip.trim()).filter(ip => ip)
      : null;

    // --scopes accepts a comma-separated list of resource:action strings,
    // e.g. "donations:read,stats:read"
    const scopes = args.scopes
      ? args.scopes.split(',').map(s => s.trim()).filter(s => s)
      : [];

    if (!name) {
      console.error('Error: --name is required');
      process.exit(1);
    }

    if (!['admin', 'user', 'signer', 'guest'].includes(role)) {
      console.error('Error: --role must be one of: admin, user, signer, guest');
      process.exit(1);
    }

    // Validate scopes if provided
    if (scopes.length > 0) {
      const { validateScopes } = require('../utils/scopeValidator');
      const validation = validateScopes(scopes);
      if (!validation.valid) {
        console.error('Error: Invalid --scopes value(s):');
        validation.errors.forEach(e => console.error('  -', e));
        process.exit(1);
      }
    }

    const keyInfo = await apiKeysModel.createApiKey({
      name,
      role,
      expiresInDays,
      createdBy: 'cli',
      metadata: { createdVia: 'cli' },
      allowedIps,
      scopes,
    });

    console.log('\n✓ API Key created successfully!\n');
    console.log('ID:', keyInfo.id);
    console.log('Key:', keyInfo.key);
    console.log('Prefix:', keyInfo.keyPrefix);
    console.log('Name:', keyInfo.name);
    console.log('Role:', keyInfo.role);
    if (keyInfo.scopes && keyInfo.scopes.length > 0) {
      console.log('Scopes:', keyInfo.scopes.join(', '));
    } else {
      console.log('Scopes: (none — full role permissions apply)');
    }
    console.log('Status:', keyInfo.status);
    console.log('Created:', new Date(keyInfo.createdAt).toISOString());
    if (keyInfo.expiresAt) {
      console.log('Expires:', new Date(keyInfo.expiresAt).toISOString());
    }
    if (keyInfo.allowedIps && keyInfo.allowedIps.length > 0) {
      console.log('Allowed IPs:', keyInfo.allowedIps.join(', '));
    }
    console.log('\n⚠️  IMPORTANT: Store this key securely. It will not be shown again.\n');
  },

  list: async (args) => {
    const filters = {};
    if (args.status) filters.status = args.status;
    if (args.role) filters.role = args.role;

    const keys = await apiKeysModel.listApiKeys(filters);

    if (keys.length === 0) {
      console.log('No API keys found.');
      return;
    }

    console.log(`\nFound ${keys.length} API key(s):\n`);

    keys.forEach(key => {
      console.log(`ID: ${key.id}`);
      console.log(`  Prefix: ${key.key_prefix}`);
      console.log(`  Name: ${key.name || 'N/A'}`);
      console.log(`  Role: ${key.role}`);
      if (key.scopes && key.scopes.length > 0) {
        console.log(`  Scopes: ${key.scopes.join(', ')}`);
      }
      console.log(`  Status: ${key.status}`);
      console.log(`  Created: ${new Date(key.created_at).toISOString()}`);
      if (key.expires_at) {
        console.log(`  Expires: ${new Date(key.expires_at).toISOString()}`);
      }
      if (key.last_used_at) {
        console.log(`  Last Used: ${new Date(key.last_used_at).toISOString()}`);
      }
      if (key.deprecated_at) {
        console.log(`  Deprecated: ${new Date(key.deprecated_at).toISOString()}`);
      }
      console.log('');
    });
  },

  deprecate: async (args) => {
    const keyId = parseInt(args.id, 10);

    if (!keyId || isNaN(keyId)) {
      console.error('Error: --id is required and must be a number');
      process.exit(1);
    }

    const success = await apiKeysModel.deprecateApiKey(keyId);

    if (success) {
      console.log(`✓ API key ${keyId} deprecated successfully`);
    } else {
      console.error(`✗ Failed to deprecate API key ${keyId} (not found or already deprecated)`);
      process.exit(1);
    }
  },

  revoke: async (args) => {
    const keyId = parseInt(args.id, 10);

    if (!keyId || isNaN(keyId)) {
      console.error('Error: --id is required and must be a number');
      process.exit(1);
    }

    const success = await apiKeysModel.revokeApiKey(keyId);

    if (success) {
      console.log(`✓ API key ${keyId} revoked successfully`);
    } else {
      console.error(`✗ Failed to revoke API key ${keyId} (not found)`);
      process.exit(1);
    }
  },

  cleanup: async (args) => {
    const retentionDays = args.retention ? parseInt(args.retention, 10) : 90;

    if (isNaN(retentionDays) || retentionDays < 1) {
      console.error('Error: --retention must be a positive number');
      process.exit(1);
    }

    const deletedCount = await apiKeysModel.cleanupOldKeys(retentionDays);
    console.log(`✓ Cleaned up ${deletedCount} old API key(s)`);
  },

  help: () => {
    console.log(`
API Key Management CLI

Usage:
  node src/scripts/manageApiKeys.js <command> [options]

Commands:
  create      Create a new API key
    --name <string>       Key name (required)
    --role <string>       Role: admin, user, guest (default: user)
    --expires <number>    Expiration in days (optional)
    --allowed-ips <ips>   Comma-separated IP addresses/CIDR ranges (optional)
                          Example: "192.168.1.0/24,10.0.0.1"
    --scopes <scopes>     Comma-separated fine-grained permission scopes (optional)
                          Restricts the key to a subset of its role's permissions.
                          Format: resource:action  (e.g. "donations:read,stats:read")
                          Omit to grant full role permissions.

  list        List all API keys
    --status <string>     Filter by status: active, deprecated, revoked
    --role <string>       Filter by role: admin, user, guest

  deprecate   Deprecate an API key (mark for future removal)
    --id <number>         Key ID (required)

  revoke      Revoke an API key (immediate invalidation)
    --id <number>         Key ID (required)

  cleanup     Clean up old expired and revoked keys
    --retention <number>  Days to retain revoked keys (default: 90)

  help        Show this help message

Examples:
  node src/scripts/manageApiKeys.js create --name "Production API" --role admin --expires 365
  node src/scripts/manageApiKeys.js create --name "Office API" --role user --allowed-ips "192.168.1.0/24,10.0.0.1"
  node src/scripts/manageApiKeys.js create --name "Analytics" --role user --scopes "donations:read,stats:read"
  node src/scripts/manageApiKeys.js list --status active
  node src/scripts/manageApiKeys.js deprecate --id 1
  node src/scripts/manageApiKeys.js revoke --id 2
  node src/scripts/manageApiKeys.js cleanup --retention 30
`);
  }
};

// Parse command line arguments
const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].substring(2);
      const value = argv[i + 1];
      args[key] = value;
      i++;
    }
  }
  return args;
};

// Main execution
(async () => {
  try {
    // Initialize database table
    await initializeApiKeysTable();

    const command = process.argv[2];
    const args = parseArgs(process.argv.slice(3));

    if (!command || command === 'help' || !commands[command]) {
      commands.help();
      process.exit(command && command !== 'help' ? 1 : 0);
    }

    await commands[command](args);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
