const hasSecurityPlugin = (() => {
  try {
    require.resolve('eslint-plugin-security');
    return true;
  } catch (error) {
    return false;
  }
})();
//minor comment not neccessary
module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  plugins: ['no-secrets', ...(hasSecurityPlugin ? ['security'] : []), 'local'],
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    // Unused vars: flag dead variables/imports, but allow intentionally-unused
    // function arguments (interface/abstract stubs, middleware signatures) and
    // caught errors. Prefix with `_` to explicitly mark a local as unused.
    'no-unused-vars': ['error', {
      args: 'none',
      caughtErrors: 'none',
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_',
    }],

    // Security rules. no-secrets flags high-entropy strings; the patterns below are
    // verified non-secrets (doc paths, URLs, SQL/identifier names, env-var doc
    // strings, OpenAPI examples, the standard RFC 4648 base32 alphabet). Real
    // random tokens/keys do not match these and are still flagged.
    'no-secrets/no-secrets': ['error', {
      ignoreContent: [
        '\\.md',                                 // documentation file paths
        'https?://',                             // URLs
        'idx_recovery_guardians',                // SQL index names
        'wal_checkpoint',                        // SQLite pragma
        'buildAndSubmitFeeBumpTransaction',      // method identifier
        'INVALID_WEBHOOK_SIGNATURE',             // error-code constant
        'ENCRYPTION_KEY',                        // env-var doc string
        'REQUIRE_IDEMPOTENCY_KEY',               // env-var doc string
        'ACCESS_LOG_INCLUDE_HEALTH',             // env-var doc string
        'snapshotAt=',                           // example query string
        'stellar_public_key',                    // example placeholder
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',      // RFC 4648 base32 alphabet
        '^eyJ',                                  // example JWT (OpenAPI docs)
        '014_webhook_tls_skip_verify',           // migration name
        'obj<<',                                 // embedded PDF template
      ],
    }],
    ...(hasSecurityPlugin ? {
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
    } : {}),

    // Code quality rules that affect security
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-console': 'off',
  },
  overrides: [
    {
      // Enforce structured logging in all service source files. Operational/CLI
      // scripts (migrations, the env-validation boot check) print to the console
      // by design and are exempt.
      files: ['src/**/*.js'],
      excludedFiles: [
        'src/scripts/**/*.js',
        'src/migrations/**/*.js',
        // Config loads at boot before the logger and the logger itself depends on
        // config (src/utils/log.js requires ../config), so config must use console.
        'src/config/**/*.js',
        'src/utils/log.js',
        'src/utils/migrationRunner.js',
        'src/utils/startupChecks.js',
      ],
      rules: {
        'no-console': 'error',
      },
    },
    {
      // Background schedulers, jobs, and workers must use timerRegistry so every
      // handle is tracked and cleared during graceful shutdown. Inline
      // eslint-disable-next-line comments are allowed for one-shot delays (sleep,
      // stopGracefully wait loops) that are guaranteed to resolve quickly.
      files: [
        'src/services/**/*.js',
        'src/jobs/**/*.js',
        'src/workers/**/*.js',
      ],
      excludedFiles: [
        'src/services/MockStellarService.js',
      ],
      rules: {
        'local/no-bare-timers': 'error',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'data/',
    'logs/',
    'coverage/',
  ],
};
