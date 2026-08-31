#!/usr/bin/env node
'use strict';

/**
 * check-test-isolation.js (#1585)
 *
 * Detects shared state that leaks between test suites. Jest runs suites in
 * parallel workers against per-worker database copies, so leakage here is not
 * about files — it is about two suites agreeing, by accident, on the same
 * fixture identifier, or overriding the same process-wide value.
 *
 * Three classes of leak are reported:
 *
 *   1. Colliding fixtures  Two suites hard-code the same fixture id (an API key
 *                          id, a wallet id, an account id). Land them in one
 *                          worker and whichever cleans up first deletes the
 *                          other's rows, so the pair passes alone and fails
 *                          together. tests/builders/uniqueId.js already exists
 *                          to prevent exactly this; this rule finds the suites
 *                          that do not use it yet.
 *   2. Overridden env      A suite assigns process.env at module scope, to a
 *                          value different from the one tests/setup.js
 *                          established, and never restores it. setupFiles runs
 *                          once per worker, so every later suite in that worker
 *                          inherits the override. Re-asserting a setup.js value
 *                          to the SAME value is redundant but harmless and is
 *                          not reported.
 *   3. Unrestored globals  The same, for assignments to `global.*`.
 *
 * Behaviour
 * ---------
 * - Prints every violation with file and line.
 * - Exits 0 when the only findings are listed in KNOWN_LEAKS (migration in
 *   progress — same pattern as check-test-naming.js).
 * - Exits 1 on any finding that is not whitelisted.
 *
 * Usage
 * -----
 *   node scripts/check-test-isolation.js           # CI gate
 *   node scripts/check-test-isolation.js --strict  # every finding is an error
 *   node scripts/check-test-isolation.js --json    # machine-readable output
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');
const STRICT = process.argv.includes('--strict');
const AS_JSON = process.argv.includes('--json');

/**
 * Findings that are known and accepted while the suite is migrated. Each entry
 * is `<relative file>::<rule>::<detail>`. Keep this list shrinking.
 */
/* eslint-disable no-secrets/no-secrets -- entries are test file paths and
   env-var names, not credentials; the entropy rule misreads the long paths. */
const KNOWN_LEAKS = new Set([
  'tests/add-openapiswagger-documentation-generation.test.js::overridden-env::API_KEYS',
  'tests/add-support-for-donation-notes-and-tags.test.js::overridden-env::API_KEYS',
  'tests/audit-log-export-extended.test.js::overridden-env::API_KEYS',
  'tests/config/configurable-data-retention-policies.test.js::overridden-env::API_KEYS',
  'tests/donations/campaign-progress-779.test.js::overridden-env::API_KEYS',
  'tests/donations/cross-asset-donations.test.js::overridden-env::API_KEYS',
  'tests/donations/donation-error-paths.test.js::overridden-env::API_KEYS',
  'tests/donations/donation-receipt-generation-pdfemail.test.js::overridden-env::API_KEYS',
  'tests/donations/donation-receipt-pdf.test.js::overridden-env::API_KEYS',
  'tests/donations/donation-routes.refactored.test.js::overridden-env::API_KEYS',
  'tests/donations/donation-routes.test.js::overridden-env::API_KEYS',
  'tests/donations/impact-reporting-sdg.test.js::overridden-env::API_KEYS',
  'tests/donations/insufficient-balance.test.js::overridden-env::API_KEYS',
  'tests/donations/receipt-endpoint-777.test.js::overridden-env::API_KEYS',
  'tests/donations/recurring-donation-pause-resume.test.js::overridden-env::API_KEYS',
  'tests/donations/send-donation.test.js::overridden-env::API_KEYS',
  'tests/donations/stream-schedules-bola-754.test.js::overridden-env::API_KEYS',
  'tests/donations/support-for-anonymous-donations-privacy-p.test.js::overridden-env::DB_JSON_PATH',
  'tests/donations/support-for-donation-notes-and-tags.test.js::overridden-env::API_KEYS',
  'tests/graphql/graphql-subscriptions.test.js::overridden-env::API_KEYS',
  'tests/graphql/graphql.test.js::overridden-env::API_KEYS',
  'tests/issues-65-66-67-68.test.js::overridden-env::API_KEYS',
  'tests/issues-764-765-766-767.test.js::overridden-env::API_KEYS',
  'tests/issues-764-765-766-767.test.js::overridden-env::MAX_DONATION_AMOUNT',
  'tests/issues-764-765-766-767.test.js::overridden-env::MIN_DONATION_AMOUNT',
  'tests/issues/808-next-execution-date.test.js::overridden-env::API_KEYS',
  'tests/issues/issue-909-receipt-get.test.js::overridden-env::API_KEYS',
  'tests/issues/issue-909-receipt-get.test.js::overridden-env::DB_JSON_PATH',
  'tests/issues/issue-911-soft-delete-schedule.test.js::overridden-env::API_KEYS',
  'tests/issues/issues-1365-1366-1367-1368.test.js::overridden-env::API_KEYS',
  'tests/liquidity-pools.test.js::overridden-env::API_KEYS',
  'tests/middleware/configurable-donation-limits-per-wallet.test.js::colliding-fixture::admin-test-key',
  'tests/middleware/configurable-donation-limits-per-wallet.test.js::colliding-fixture::test-key-1',
  'tests/middleware/per-wallet-donation-limits.test.js::overridden-env::API_KEYS',
  'tests/misc/account-data-entries.test.js::overridden-env::API_KEYS',
  'tests/misc/account-merge-validation.test.js::overridden-env::API_KEYS',
  'tests/misc/clawback.test.js::overridden-env::API_KEYS',
  'tests/misc/edge-cases.test.js::overridden-env::API_KEYS',
  'tests/misc/home-domain-management.test.js::overridden-env::API_KEYS',
  'tests/misc/partial-failure-scenarios.test.js::overridden-env::API_KEYS',
  'tests/misc/stellar-claimable-balance.test.js::overridden-env::API_KEYS',
  'tests/routes/issue-1113-csv-formula-injection.test.js::overridden-env::API_KEYS',
  'tests/stellar/federation-lookup.test.js::overridden-env::API_KEYS',
  'tests/stellar/federation-lookup.test.js::overridden-env::FEDERATION_CACHE_TTL',
  'tests/stellar/fee-estimation.test.js::overridden-env::API_KEYS',
  'tests/stellar/stellar-federation-protocol.test.js::overridden-env::API_KEYS',
  'tests/stellar/support-for-stellar-offers-and-dex-trading.test.js::overridden-env::API_KEYS',
  'tests/stream/schedule-cancel-778.test.js::overridden-env::API_KEYS',
  'tests/transactions/fee-installment-payments.test.js::colliding-fixture::admin-test-key',
  'tests/transactions/fee-installment-payments.test.js::colliding-fixture::test-key-1',
  'tests/transactions/multisignature-transaction.test.js::overridden-env::API_KEYS',
  'tests/transactions/stellar-memo-type-text-hash-id-r.test.js::overridden-env::API_KEYS',
  'tests/transactions/stellar-path-payment-crossasset-do.test.js::overridden-env::API_KEYS',
  'tests/transactions/stellar-transaction-memo-encryption.test.js::overridden-env::ENCRYPTION_KEY',
  'tests/transactions/stellar-tx-hash-776.test.js::overridden-env::API_KEYS',
  'tests/transactions/support-for-stellar-payment-channels.test.js::overridden-env::API_KEYS',
  'tests/transactions/transaction-date-range-filter.test.js::overridden-env::API_KEYS',
  'tests/transactions/transaction-rollback-on-partial-failure.test.js::colliding-fixture::admin-test-key',
  'tests/transactions/transaction-rollback-on-partial-failure.test.js::colliding-fixture::test-key-1',
  'tests/transactions/transaction-search-and-filtering.test.js::overridden-env::API_KEYS',
  'tests/transactions/transaction-simulation.test.js::overridden-env::API_KEYS',
  'tests/utils/pagination-to-all-list-endpoints.test.js::overridden-env::DB_JSON_PATH',
  'tests/wallets/account-options.test.js::overridden-env::API_KEYS',
  'tests/wallets/bulk-import-caps.test.js::overridden-env::API_KEYS',
  'tests/wallets/bulk-wallet-import.test.js::overridden-env::API_KEYS',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::cacheMiddleware',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::friendbotRateLimiter',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::requireAuth',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::requirePermission',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::validateDataEntry',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::validateSchema',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::walletCreateSchema',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::walletIdSchema',
  'tests/wallets/fix-wallet-transactions-404.test.js::unrestored-global::walletPublicKeySchema',
  'tests/wallets/support-for-stellar-account-sponsorship.test.js::overridden-env::API_KEYS',
  'tests/webhooks/webhooks.test.js::overridden-env::API_KEYS',
]);
/* eslint-enable no-secrets/no-secrets */

/** Directories that do not take part in the parallel unit run. */
const SKIP_DIRS = new Set(['e2e', 'fixtures', '__snapshots__', 'helpers', 'builders']);

/** Fixture constants below this value are ordinary numbers, not identifiers. */
const MIN_FIXTURE_ID = 1000;

const ENV_ASSIGN = /^process\.env\.([A-Z0-9_]+)\s*=\s*(.+?);?\s*$/;
const GLOBAL_ASSIGN = /^global\.([A-Za-z0-9_$]+)\s*=\s*(.+?);?\s*$/;

/**
 * Every `*.test.js` under tests/, excluding directories that do not take part
 * in the parallel unit run.
 * @param {string} dir
 * @returns {string[]} Absolute paths
 */
function collectTestFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) found.push(...collectTestFiles(full));
    } else if (entry.name.endsWith('.test.js')) {
      found.push(full);
    }
  }
  return found;
}

/**
 * The env values tests/setup.js establishes for every worker. A suite that
 * re-asserts one of these to the same value changes nothing; only a different
 * value can alter what a later suite in the same worker sees.
 * @returns {Map<string, string>} Variable name to its literal source text
 */
function readSetupEnvBaseline() {
  const setupPath = path.join(TESTS_DIR, 'setup.js');
  const baseline = new Map();
  if (!fs.existsSync(setupPath)) return baseline;
  for (const line of fs.readFileSync(setupPath, 'utf8').split('\n')) {
    const match = line.match(ENV_ASSIGN);
    if (match) baseline.set(match[1], match[2].trim());
  }
  return baseline;
}

/**
 * Hard-coded fixture identifiers declared in a suite.
 * Matches `const TEST_SOMETHING_ID = 99901;` and its string equivalent.
 * @param {string} source
 * @returns {Array<{ name: string, value: string, line: number }>}
 */
function findFixtureIds(source) {
  const pattern = /^[ \t]*const[ \t]+([A-Z][A-Z0-9_]*(?:_ID|_KEY|_ACCOUNT)S?[0-9_]*)[ \t]*=[ \t]*(\d+|'[^']*'|"[^"]*")[ \t]*;/gm;
  const found = [];
  let match = pattern.exec(source);
  while (match !== null) {
    const value = match[2].replace(/['"]/g, '');
    const numeric = /^\d+$/.test(value);
    if (value && (!numeric || Number(value) >= MIN_FIXTURE_ID)) {
      found.push({
        name: match[1],
        value,
        line: source.slice(0, match.index).split('\n').length,
      });
    }
    match = pattern.exec(source);
  }
  return found;
}

/**
 * Module-scope mutations that outlive the suite. A line is module-scope when it
 * starts at indentation zero; anything nested sits inside a hook or callback
 * and is assumed to carry its own cleanup.
 * @param {string} source
 * @param {RegExp} pattern - Must capture the name in group 1 and value in group 2
 * @returns {Array<{ name: string, value: string|null, line: number }>}
 */
function findTopLevelMutations(source, pattern) {
  const found = [];
  source.split('\n').forEach((text, index) => {
    if (/^\s/.test(text)) return;
    const match = text.match(pattern);
    if (!match) return;
    found.push({
      name: match[1],
      value: match[2] ? match[2].trim() : null,
      line: index + 1,
    });
  });
  return found;
}

/**
 * Whether a suite mentions a name inside any teardown hook, which is taken as
 * restoring it.
 * @param {string} source
 * @param {string} name
 * @returns {boolean}
 */
function restoresLater(source, name) {
  const teardown = /(?:afterAll|afterEach)\s*\(([\s\S]*?)\n\}\)/g;
  let match = teardown.exec(source);
  while (match !== null) {
    if (match[1].includes(name)) return true;
    match = teardown.exec(source);
  }
  return false;
}

/**
 * Builds one finding for an unrestored mutation.
 * @param {object} spec - Rule spec
 * @param {object} hit - The mutation
 * @param {string} relative - Repo-relative path
 * @param {boolean} overrides - Whether it overrides a setup.js value
 * @returns {object} Finding
 */
function mutationFinding(spec, hit, relative, overrides) {
  const overrideNote = overrides
    ? ', overriding the value tests/setup.js sets for every worker'
    : '';
  return {
    file: relative,
    rule: spec.rule,
    detail: hit.name,
    line: hit.line,
    message:
      'sets ' + spec.label + '.' + hit.name + ' at module scope and never restores it' +
      overrideNote +
      '; setupFiles runs once per worker, so a later suite in the same worker inherits it',
  };
}

/**
 * Unrestored module-scope mutations for one suite.
 * @param {string} source
 * @param {string} relative
 * @param {Map<string, string>} envBaseline
 * @returns {Array<object>} Findings
 */
function checkMutations(source, relative, envBaseline) {
  const specs = [
    { pattern: ENV_ASSIGN, rule: 'overridden-env', label: 'process.env', baseline: envBaseline },
    { pattern: GLOBAL_ASSIGN, rule: 'unrestored-global', label: 'global', baseline: null },
  ];
  const findings = [];
  for (const spec of specs) {
    for (const hit of findTopLevelMutations(source, spec.pattern)) {
      if (restoresLater(source, hit.name)) continue;
      if (spec.baseline && spec.baseline.get(hit.name) === hit.value) continue;
      const overrides = Boolean(spec.baseline && spec.baseline.has(hit.name));
      findings.push(mutationFinding(spec, hit, relative, overrides));
    }
  }
  return findings;
}

/**
 * Fixture identifiers claimed by more than one suite.
 * @param {Map<string, Array<{file: string, name: string, line: number}>>} byValue
 * @returns {Array<object>} Findings
 */
function checkCollisions(byValue) {
  const findings = [];
  for (const [value, uses] of byValue) {
    const files = new Set(uses.map((use) => use.file));
    if (files.size < 2) continue;
    for (const use of uses) {
      const others = [...files].filter((file) => file !== use.file).join(', ');
      findings.push({
        file: use.file,
        rule: 'colliding-fixture',
        detail: value,
        line: use.line,
        message:
          use.name + ' = ' + value + ' is also used by ' + others + '; ' +
          'use tests/builders/uniqueId.js so one suite cleanup cannot delete rows ' +
          'another suite is still asserting on',
      });
    }
  }
  return findings;
}

/**
 * Runs every rule across the test tree.
 * @returns {Array<object>} Findings
 */
function analyze() {
  const byValue = new Map();
  const envBaseline = readSetupEnvBaseline();
  let findings = [];

  for (const file of collectTestFiles(TESTS_DIR)) {
    const relative = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    const source = fs.readFileSync(file, 'utf8');

    findings = findings.concat(checkMutations(source, relative, envBaseline));

    for (const fixture of findFixtureIds(source)) {
      if (!byValue.has(fixture.value)) byValue.set(fixture.value, []);
      byValue.get(fixture.value).push({
        file: relative,
        name: fixture.name,
        line: fixture.line,
      });
    }
  }

  return findings.concat(checkCollisions(byValue));
}

/**
 * Stable key used to whitelist a finding.
 * @param {object} finding
 * @returns {string}
 */
function keyOf(finding) {
  return finding.file + '::' + finding.rule + '::' + finding.detail;
}

/**
 * Prints findings in human-readable form.
 * @param {Array<object>} findings
 */
function report(findings) {
  process.stdout.write('Test isolation: ' + findings.length + ' finding(s)\n\n');
  for (const finding of findings) {
    const known = !STRICT && KNOWN_LEAKS.has(keyOf(finding)) ? ' [known]' : '';
    process.stdout.write('  ' + finding.file + ':' + finding.line + known + '\n');
    process.stdout.write('    ' + finding.rule + ': ' + finding.message + '\n');
  }
}

function main() {
  const findings = analyze();
  const unknown = STRICT ? findings : findings.filter((f) => !KNOWN_LEAKS.has(keyOf(f)));

  if (AS_JSON) {
    process.stdout.write(JSON.stringify({ findings, unknown }, null, 2) + '\n');
    process.exit(unknown.length > 0 ? 1 : 0);
  }

  if (findings.length === 0) {
    process.stdout.write('No cross-suite state leakage detected.\n');
    process.exit(0);
  }

  report(findings);

  if (unknown.length > 0) {
    process.stdout.write(
      '\n' + unknown.length + ' finding(s) are not whitelisted. ' +
      'Fix them, or add them to KNOWN_LEAKS with a reason.\n'
    );
    process.exit(1);
  }

  process.stdout.write('\nAll findings are known. Exiting 0.\n');
  process.exit(0);
}

if (require.main === module) main();

module.exports = {
  analyze,
  readSetupEnvBaseline,
  collectTestFiles,
  findFixtureIds,
  findTopLevelMutations,
  restoresLater,
  keyOf,
};
