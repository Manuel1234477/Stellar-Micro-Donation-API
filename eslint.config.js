'use strict';

const path = require('path');

// ---------------------------------------------------------------------------
// Grandfathered lists (ported from .eslintrc.js)
// ---------------------------------------------------------------------------

const GRANDFATHERED_LARGE_FILES = [
  'src/routes/donations.js',
  'src/routes/wallets.js',
  'src/routes/admin/analytics.js',
  'src/routes/admin/db.js',
  'src/routes/admin/index.js',
  'src/routes/admin/settings.js',
  'src/routes/stellar.js',
  'src/services/stellarService.js',
  'src/services/transactionService.js',
  'src/services/walletService.js',
  'src/services/donationService.js',
  'src/middleware/auth.js',
  'src/middleware/rateLimiter.js',
  'src/utils/validation.js',
];

const GRANDFATHERED_EXPORT_SHAPES = [
  'src/routes/donations.js',
  'src/routes/wallets.js',
  'src/routes/admin/analytics.js',
  'src/routes/admin/db.js',
  'src/routes/admin/index.js',
  'src/routes/admin/settings.js',
  'src/routes/stellar.js',
  'src/services/stellarService.js',
  'src/services/transactionService.js',
  'src/services/walletService.js',
  'src/services/donationService.js',
  'src/middleware/auth.js',
  'src/middleware/rateLimiter.js',
  'src/utils/validation.js',
];

let PROCESS_ENV_GRANDFATHERED = [];
try {
  PROCESS_ENV_GRANDFATHERED = require('./eslint-rules/process-env-grandfathered.json');
} catch (err) {
  PROCESS_ENV_GRANDFATHERED = [];
}

// ---------------------------------------------------------------------------
// Optional plugins (guarded by require.resolve)
// ---------------------------------------------------------------------------

let securityPlugin = null;
try {
  require.resolve('eslint-plugin-security');
  securityPlugin = require('eslint-plugin-security');
} catch (err) {
  securityPlugin = null;
}

let noSecretsPlugin = null;
try {
  require.resolve('eslint-plugin-no-secrets');
  noSecretsPlugin = require('eslint-plugin-no-secrets');
} catch (err) {
  noSecretsPlugin = null;
}

let localPlugin = null;
try {
  localPlugin = require('./eslint-rules/index.js');
} catch (err) {
  localPlugin = null;
}

// ---------------------------------------------------------------------------
// Base rules
// ---------------------------------------------------------------------------

const baseRules = {
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-undef': 'error',
  'no-console': 'warn',
  'no-var': 'error',
  'prefer-const': 'warn',
  'eqeqeq': ['warn', 'smart'],
  'no-duplicate-imports': 'warn',
  'no-shadow': 'warn',
  'no-return-await': 'warn',
  'no-throw-literal': 'error',
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-with': 'error',
  'no-caller': 'error',
  'no-extend-native': 'error',
  'no-iterator': 'error',
  'no-proto': 'error',
  'no-sequences': 'warn',
  'no-unmodified-loop-condition': 'warn',
  'no-unreachable-loop': 'warn',
  'no-useless-catch': 'warn',
  'no-useless-return': 'warn',
  'require-await': 'warn',
  'no-async-promise-executor': 'error',
  'no-await-in-loop': 'off',
  'no-promise-executor-return': 'warn',
  'no-template-curly-in-string': 'warn',
  'no-unneeded-ternary': 'warn',
  'no-useless-escape': 'warn',
  'no-self-compare': 'error',
  'no-constant-condition': ['warn', { checkLoops: false }],
  'no-empty': ['warn', { allowEmptyCatch: true }],
  'no-fallthrough': 'error',
  'no-redeclare': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
};

// ---------------------------------------------------------------------------
// Security plugin rules
// ---------------------------------------------------------------------------

const securityRules = securityPlugin
  ? {
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-require': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
    }
  : {};

// ---------------------------------------------------------------------------
// no-secrets plugin rules
// ---------------------------------------------------------------------------

const noSecretsRules = noSecretsPlugin
  ? {
      'no-secrets/no-secrets': ['warn', { tolerance: 4.5 }],
    }
  : {};

// ---------------------------------------------------------------------------
// Local plugin rules
// ---------------------------------------------------------------------------

const localRules = localPlugin && localPlugin.rules
  ? Object.keys(localPlugin.rules).reduce((acc, ruleName) => {
      acc[`local/${ruleName}`] = 'warn';
      return acc;
    }, {})
  : {};

// ---------------------------------------------------------------------------
// Assemble plugins object
// ---------------------------------------------------------------------------

const plugins = {};
if (securityPlugin) {
  plugins.security = securityPlugin;
}
if (noSecretsPlugin) {
  plugins['no-secrets'] = noSecretsPlugin;
}
if (localPlugin) {
  plugins.local = localPlugin;
}

// ---------------------------------------------------------------------------
// Flat config
// ---------------------------------------------------------------------------

module.exports = [
  {
    // Issue #2086: the legacy route shims are gone — import the canonical
    // routers (routes/donations, routes/wallets, routes/transactions) instead.
    files: ['**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: './routes/donation',
              message: 'Import src/routes/donations instead (issue #2086).',
            },
            {
              name: './routes/wallet',
              message: 'Import src/routes/wallets instead (issue #2086).',
            },
            {
              name: './routes/transaction',
              message: 'Import src/routes/transactions instead (issue #2086).',
            },
          ],
          patterns: [
            {
              group: ['**/routes/donation', '**/routes/wallet', '**/routes/transaction'],
              message:
                'Import the canonical routers (routes/donations, routes/wallets, routes/transactions) instead (issue #2086).',
            },
          ],
        },
      ],
    },
  },
  // Top-level ignores (ported from .eslintignore)
  {
    ignores: [
      'node_modules/',
      'data/',
      'logs/',
      '*.db',
      'coverage/',
      'tests/',
      'test-*.js',
      'dist/',
      'build/',
    ],
  },

  // Base config for all JS files
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node.js globals
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        global: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        // Jest globals (for any test files that slip through)
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        jest: 'readonly',
      },
    },
    plugins,
    rules: {
      ...baseRules,
      ...securityRules,
      ...noSecretsRules,
      ...localRules,
    },
  },

  // Grandfathered export shapes: allow module.exports reassignment patterns
  {
    files: ['**/*.js'],
    ignores: GRANDFATHERED_EXPORT_SHAPES,
    rules: {
      // Placeholder for export-shape rule; kept for parity with legacy config.
    },
  },

  // Grandfathered large files: relax complexity/size rules
  {
    files: GRANDFATHERED_LARGE_FILES,
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'complexity': 'off',
    },
  },

  // no-console for src/**
  {
    files: ['src/**/*.js'],
    rules: {
      'no-console': 'warn',
    },
  },

  // Direct process.env reads (#2111). Environment variables must be read
  // through src/config (readEnv() / env from src/config/env.js) so they are
  // declared in the schema, validated, documented in .env.example and coerced
  // consistently. `no-restricted-syntax` is used instead of
  // `no-restricted-properties` so that `process.env.NODE_ENV` can stay
  // allowlisted during the migration. Files in eslint-rules/
  // process-env-grandfathered.json are exempt until migrated; the overall
  // count is ratcheted by scripts/check-process-env-count.js.
  {
    files: ['src/**/*.js'],
    ignores: ['src/config/**', ...PROCESS_ENV_GRANDFATHERED],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector:
            "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env'][property.name!='NODE_ENV']",
          message:
            'Read environment variables through readEnv() from src/config/env.js (declare them in src/config/envSchema.js) instead of process.env (#2111).',
        },
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']:not(MemberExpression > .object)",
          message:
            'Do not pass process.env around or destructure it outside src/config; use readEnv() from src/config/env.js (#2111).',
        },
      ],
    },
  },
];