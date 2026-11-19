'use strict';
/**
 * CI check for the Prometheus alert rules (issue #1967).
 *
 * 1. Metric existence: every metric referenced in an alert expression must be
 *    emitted by the application. The registry in src/utils/metrics.js is read
 *    in-process (including prom-client's default Node.js/process metrics), so
 *    no server has to be started. Histogram sample suffixes (_bucket, _count,
 *    _sum) are accepted when the base name is a registered histogram.
 *    Series scraped by Prometheus itself (e.g. `up`) are allowlisted below.
 *
 * 2. Alert coverage: every alert must have at least one promtool unit test
 *    expecting it to fire and at least one expecting it not to fire, and every
 *    alertname referenced by a test must exist in the rules file.
 *
 * Syntax validation and the unit tests themselves run via promtool in
 * .github/workflows/prometheus-rules.yml.
 *
 * Exits with code 1 when a check fails.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const RULES_FILE = path.join(ROOT, 'monitoring', 'prometheus-alerts.yml');
const TESTS_DIR = path.join(ROOT, 'monitoring', 'tests');

// Series that Prometheus generates for scrape targets rather than the app.
const SCRAPE_GENERATED = new Set(['up']);

// PromQL functions, aggregation operators and keywords (not metric names).
const PROMQL_WORDS = new Set([
  'rate', 'irate', 'increase', 'delta', 'idelta', 'deriv', 'sum', 'avg', 'min', 'max',
  'count', 'group', 'stddev', 'stdvar', 'topk', 'bottomk', 'quantile', 'count_values',
  'histogram_quantile', 'vector', 'scalar', 'absent', 'absent_over_time', 'clamp', 'clamp_min',
  'clamp_max', 'abs', 'round', 'time', 'by', 'without', 'on', 'ignoring', 'group_left',
  'group_right', 'and', 'or', 'unless', 'bool', 'offset',
  'avg_over_time', 'max_over_time', 'min_over_time', 'sum_over_time', 'last_over_time',
]);

const HISTOGRAM_SUFFIXES = ['_bucket', '_count', '_sum'];

/**
 * Collect the metric names the application exposes.
 * metrics.js only collects default metrics outside test environments, so the
 * environment is set before the module is loaded.
 */
async function loadEmittedMetricNames() {
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'testing') {
    process.env.NODE_ENV = 'metrics-check';
  }
  const { registry } = require(path.join(ROOT, 'src', 'utils', 'metrics.js'));
  const names = new Map(); // name -> type
  for (const metric of await registry.getMetricsAsJSON()) {
    names.set(metric.name, metric.type);
  }
  return names;
}

/**
 * Extract metric-name tokens from a PromQL expression. Label matchers,
 * range selectors and grouping clauses are removed first so that label names
 * and label values are not mistaken for metrics.
 */
function metricNamesInExpr(expr) {
  const stripped = expr
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(by|without|on|ignoring)\s*\([^)]*\)/g, ' ');
  const tokens = stripped.match(/[A-Za-z_:][A-Za-z0-9_:]*/g) || [];
  return tokens.filter((t) => !PROMQL_WORDS.has(t));
}

function isEmitted(name, emitted) {
  if (emitted.has(name) || SCRAPE_GENERATED.has(name)) return true;
  for (const suffix of HISTOGRAM_SUFFIXES) {
    if (name.endsWith(suffix)) {
      const base = name.slice(0, -suffix.length);
      if (emitted.get(base) === 'histogram' || emitted.get(base) === 'summary') return true;
    }
  }
  return false;
}

function checkMetricReferences(rules, emitted) {
  const problems = [];
  for (const group of rules.groups || []) {
    for (const rule of group.rules || []) {
      if (!rule.expr) continue;
      const label = rule.alert || rule.record || '(unnamed rule)';
      for (const name of new Set(metricNamesInExpr(String(rule.expr)))) {
        if (!isEmitted(name, emitted)) {
          problems.push(`${label}: metric "${name}" is not emitted by src/utils/metrics.js`);
        }
      }
    }
  }
  return problems;
}

function loadTestFiles() {
  if (!fs.existsSync(TESTS_DIR)) return [];
  return fs
    .readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.yml') || f.endsWith('.test.yaml'))
    .map((f) => path.join(TESTS_DIR, f));
}

function checkAlertCoverage(rules) {
  const problems = [];
  const alertNames = new Set();
  for (const group of rules.groups || []) {
    for (const rule of group.rules || []) {
      if (rule.alert) alertNames.add(rule.alert);
    }
  }

  const coverage = new Map(); // alertname -> { fires, quiet }
  const entry = (name) => {
    if (!coverage.has(name)) coverage.set(name, { fires: 0, quiet: 0 });
    return coverage.get(name);
  };

  for (const file of loadTestFiles()) {
    const doc = yaml.load(fs.readFileSync(file, 'utf8'));
    for (const test of (doc && doc.tests) || []) {
      for (const check of test.alert_rule_test || []) {
        if (!alertNames.has(check.alertname)) {
          problems.push(`${path.basename(file)}: test references unknown alert "${check.alertname}"`);
          continue;
        }
        const expected = check.exp_alerts || [];
        if (expected.length > 0) entry(check.alertname).fires++;
        else entry(check.alertname).quiet++;
      }
    }
  }

  for (const name of [...alertNames].sort()) {
    const c = coverage.get(name);
    if (!c || c.fires === 0) problems.push(`alert "${name}" has no unit test expecting it to fire`);
    if (!c || c.quiet === 0) problems.push(`alert "${name}" has no unit test expecting it not to fire`);
  }
  return { problems, alertCount: alertNames.size };
}

async function main() {
  const rules = yaml.load(fs.readFileSync(RULES_FILE, 'utf8'));
  const emitted = await loadEmittedMetricNames();

  const metricProblems = checkMetricReferences(rules, emitted);
  const { problems: coverageProblems, alertCount } = checkAlertCoverage(rules);
  const problems = [...metricProblems, ...coverageProblems];

  if (problems.length > 0) {
    console.error(`Prometheus rule checks failed (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `Prometheus rule checks passed: ${alertCount} alerts, all referenced metrics emitted, ` +
      'each alert has firing and non-firing unit tests.'
  );
}

main().catch((err) => {
  console.error('check-prometheus-rules failed:', err);
  process.exit(1);
});
