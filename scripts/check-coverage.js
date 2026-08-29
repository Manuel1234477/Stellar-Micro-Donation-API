#!/usr/bin/env node

/**
 * Coverage Check Script
 * Validates test coverage meets minimum thresholds before commit.
 * Also supports LCOV delta parsing and PR coverage diff comment generation.
 *
 * Usage:
 *   node scripts/check-coverage.js                  # check thresholds only
 *   node scripts/check-coverage.js --diff \
 *     --base=coverage/base-lcov.info \
 *     --head=coverage/lcov.info \
 *     --output=coverage/diff-comment.md             # generate diff comment
 */

'use strict';

const fs = require('fs');
const path = require('path');

const COVERAGE_FILE = path.join(__dirname, '../coverage/coverage-summary.json');
const THRESHOLDS = {
  branches: 60,
  functions: 60,
  lines: 60,
  statements: 60
};

// ---------------------------------------------------------------------------
// Existing threshold-check logic
// ---------------------------------------------------------------------------

function checkCoverage() {
  console.log('🔍 Checking test coverage...\n');

  // Check if coverage file exists
  if (!fs.existsSync(COVERAGE_FILE)) {
    console.error('❌ Coverage file not found!');
    console.error('Run: npm run test:coverage\n');
    process.exit(1);
  }

  // Read coverage data
  const coverage = JSON.parse(fs.readFileSync(COVERAGE_FILE, 'utf8'));
  const total = coverage.total;

  // Check each metric
  const results = [];
  let allPassed = true;

  for (const [metric, threshold] of Object.entries(THRESHOLDS)) {
    const actual = total[metric].pct;
    const passed = actual >= threshold;

    results.push({
      metric,
      threshold,
      actual,
      passed
    });

    if (!passed) {
      allPassed = false;
    }
  }

  // Display results
  console.log('Coverage Results:');
  console.log('─'.repeat(60));

  results.forEach(({ metric, threshold, actual, passed }) => {
    const status = passed ? '✅' : '❌';
    const metricName = metric.padEnd(12);
    const actualStr = `${actual.toFixed(2)}%`.padStart(8);
    const thresholdStr = `${threshold}%`.padStart(8);

    console.log(`${status} ${metricName} ${actualStr} (min: ${thresholdStr})`);
  });

  console.log('─'.repeat(60));

  if (allPassed) {
    console.log('\n✅ All coverage thresholds met!');
    console.log('Your changes maintain code quality standards.\n');
    process.exit(0);
  } else {
    console.log('\n❌ Coverage thresholds not met!');
    console.log('Please add tests to cover your changes.\n');
    console.log('Tips:');
    console.log('  1. Run: npm run test:coverage');
    console.log('  2. Open: coverage/lcov-report/index.html');
    console.log('  3. Add tests for uncovered code');
    console.log('  4. Run this script again\n');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// LCOV parsing
// ---------------------------------------------------------------------------

/**
 * Parse an lcov.info file and return structured coverage data.
 *
 * LCOV format summary:
 *   SF:<source file>
 *   FN:<line>,<function name>
 *   FNDA:<call count>,<function name>
 *   FNF:<functions found>
 *   FNH:<functions hit>
 *   BRDA:<line>,<block>,<branch>,<taken>   (taken is "-" when never executed)
 *   BRF:<branches found>
 *   BRH:<branches hit>
 *   DA:<line>,<hit count>
 *   LF:<lines found>
 *   LH:<lines hit>
 *   end_of_record
 *
 * @param {string} lcovPath  Path to the lcov.info file.
 * @returns {{
 *   files: {
 *     [filename: string]: {
 *       lines:     { found: number, hit: number, details: { [line: number]: number } },
 *       branches:  { found: number, hit: number },
 *       functions: { found: number, hit: number }
 *     }
 *   },
 *   totals: {
 *     lines:     { found: number, hit: number },
 *     branches:  { found: number, hit: number },
 *     functions: { found: number, hit: number }
 *   }
 * }}
 */
function parseLcovFile(lcovPath) {
  if (!fs.existsSync(lcovPath)) {
    return { files: {}, totals: { lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 } } };
  }

  const content = fs.readFileSync(lcovPath, 'utf8');
  const lines = content.split('\n');

  const files = {};
  let current = null;

  // Accumulators for the current record
  let lineDetails = {};   // line -> hit count
  let branchFound = 0;
  let branchHit = 0;
  let fnFound = 0;
  let fnHit = 0;
  let lineFound = 0;
  let lineHit = 0;

  const resetRecord = () => {
    lineDetails = {};
    branchFound = 0;
    branchHit = 0;
    fnFound = 0;
    fnHit = 0;
    lineFound = 0;
    lineHit = 0;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('SF:')) {
      current = line.slice(3).trim();
      resetRecord();
    } else if (line.startsWith('DA:')) {
      // DA:<line number>,<execution count>
      const parts = line.slice(3).split(',');
      const lineNo = parseInt(parts[0], 10);
      const hits = parseInt(parts[1], 10);
      if (!isNaN(lineNo)) {
        lineDetails[lineNo] = (lineDetails[lineNo] || 0) + (isNaN(hits) ? 0 : hits);
      }
    } else if (line.startsWith('BRDA:')) {
      // BRDA:<line>,<block>,<branch>,<taken>
      const parts = line.slice(5).split(',');
      const taken = parts[3];
      branchFound += 1;
      if (taken !== undefined && taken.trim() !== '-' && parseInt(taken, 10) > 0) {
        branchHit += 1;
      }
    } else if (line.startsWith('BRF:')) {
      // Override accumulated count with the summary line if present
      const n = parseInt(line.slice(4), 10);
      if (!isNaN(n)) branchFound = n;
    } else if (line.startsWith('BRH:')) {
      const n = parseInt(line.slice(4), 10);
      if (!isNaN(n)) branchHit = n;
    } else if (line.startsWith('FNF:')) {
      const n = parseInt(line.slice(4), 10);
      if (!isNaN(n)) fnFound = n;
    } else if (line.startsWith('FNH:')) {
      const n = parseInt(line.slice(4), 10);
      if (!isNaN(n)) fnHit = n;
    } else if (line.startsWith('LF:')) {
      const n = parseInt(line.slice(3), 10);
      if (!isNaN(n)) lineFound = n;
    } else if (line.startsWith('LH:')) {
      const n = parseInt(line.slice(3), 10);
      if (!isNaN(n)) lineHit = n;
    } else if (line === 'end_of_record') {
      if (current) {
        // Derive LF/LH from DA entries when summary lines are absent
        if (lineFound === 0 && Object.keys(lineDetails).length > 0) {
          lineFound = Object.keys(lineDetails).length;
          lineHit = Object.values(lineDetails).filter(h => h > 0).length;
        }

        files[current] = {
          lines: {
            found: lineFound,
            hit: lineHit,
            details: { ...lineDetails }
          },
          branches: { found: branchFound, hit: branchHit },
          functions: { found: fnFound, hit: fnHit }
        };
      }
      current = null;
      resetRecord();
    }
  }

  // Compute totals
  const totals = {
    lines:     { found: 0, hit: 0 },
    branches:  { found: 0, hit: 0 },
    functions: { found: 0, hit: 0 }
  };

  for (const file of Object.values(files)) {
    totals.lines.found     += file.lines.found;
    totals.lines.hit       += file.lines.hit;
    totals.branches.found  += file.branches.found;
    totals.branches.hit    += file.branches.hit;
    totals.functions.found += file.functions.found;
    totals.functions.hit   += file.functions.hit;
  }

  return { files, totals };
}

// ---------------------------------------------------------------------------
// Summary helper
// ---------------------------------------------------------------------------

/**
 * Parse an lcov.info file and return percentage-based totals.
 *
 * @param {string} lcovPath
 * @returns {{ lines: number, branches: number, functions: number }}
 */
function parseLcovSummary(lcovPath) {
  const { totals } = parseLcovFile(lcovPath);

  const pct = (hit, found) => (found > 0 ? (hit / found) * 100 : 0);

  return {
    lines:     pct(totals.lines.hit,     totals.lines.found),
    branches:  pct(totals.branches.hit,  totals.branches.found),
    functions: pct(totals.functions.hit, totals.functions.found)
  };
}

// ---------------------------------------------------------------------------
// Delta computation
// ---------------------------------------------------------------------------

/**
 * Compute per-file and overall coverage delta between a base and head lcov.
 *
 * @param {{ files: object, totals: object }} baseLcov  Result of parseLcovFile for base branch.
 * @param {{ files: object, totals: object }} headLcov  Result of parseLcovFile for head branch.
 * @returns {{
 *   overall: { base: number, head: number, delta: number },
 *   files: Array<{
 *     file: string,
 *     basePct: number,
 *     headPct: number,
 *     delta: number,
 *     uncoveredLines: number[]
 *   }>,
 *   regressions: string[],
 *   improvements: string[]
 * }}
 */
function computeCoverageDelta(baseLcov, headLcov) {
  const linePct = (data) => {
    if (!data || data.lines.found === 0) return 0;
    return (data.lines.hit / data.lines.found) * 100;
  };

  const totalPct = (totals) => {
    if (!totals || totals.lines.found === 0) return 0;
    return (totals.lines.hit / totals.lines.found) * 100;
  };

  const overallBase = totalPct(baseLcov.totals);
  const overallHead = totalPct(headLcov.totals);

  // Union of all file names present in either snapshot
  const allFiles = new Set([
    ...Object.keys(baseLcov.files),
    ...Object.keys(headLcov.files)
  ]);

  const fileDeltas = [];
  const regressions = [];
  const improvements = [];

  for (const file of allFiles) {
    const baseData = baseLcov.files[file] || null;
    const headData = headLcov.files[file] || null;

    const basePct = linePct(baseData);
    const headPct = linePct(headData);
    const delta = headPct - basePct;

    // Collect uncovered line numbers from head snapshot
    const uncoveredLines = [];
    if (headData && headData.lines.details) {
      for (const [lineNo, hits] of Object.entries(headData.lines.details)) {
        if (hits === 0) {
          uncoveredLines.push(parseInt(lineNo, 10));
        }
      }
      uncoveredLines.sort((a, b) => a - b);
    }

    fileDeltas.push({ file, basePct, headPct, delta, uncoveredLines });

    // Only flag files that actually changed
    if (Math.abs(delta) > 0.01) {
      if (delta < 0) {
        regressions.push(file);
      } else {
        improvements.push(file);
      }
    }
  }

  // Sort by absolute delta descending so biggest changes appear first
  fileDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    overall: {
      base:  overallBase,
      head:  overallHead,
      delta: overallHead - overallBase
    },
    files: fileDeltas,
    regressions,
    improvements
  };
}

// ---------------------------------------------------------------------------
// Markdown comment formatter
// ---------------------------------------------------------------------------

/**
 * Format a coverage delta object into a GitHub PR comment (Markdown).
 *
 * @param {{
 *   overall: { base: number, head: number, delta: number },
 *   files: Array<{ file: string, basePct: number, headPct: number, delta: number, uncoveredLines: number[] }>,
 *   regressions: string[],
 *   improvements: string[]
 * }} delta
 * @returns {string}  Markdown suitable for posting as a GitHub comment.
 */
function formatCoverageDiffComment(delta) {
  const MARKER = '<!-- coverage-diff-comment -->';

  const fmt = (n) => `${n.toFixed(2)}%`;
  const sign = (n) => (n >= 0 ? `+${fmt(n)}` : fmt(n));

  const deltaEmoji = (d) => {
    if (d < -0.01) return '🔴';
    if (d > 0.01)  return '🟢';
    return '⚪';
  };

  const lines = [];

  lines.push(MARKER);
  lines.push('');
  lines.push('## 📊 Coverage Report');
  lines.push('');

  // ── Overall table ──────────────────────────────────────────────────────
  lines.push('### Overall Coverage');
  lines.push('');
  lines.push('| | Coverage |');
  lines.push('|---|---|');
  lines.push(`| **Base branch** | ${fmt(delta.overall.base)} |`);
  lines.push(`| **This PR**     | ${fmt(delta.overall.head)} |`);
  lines.push(`| **Delta**       | ${deltaEmoji(delta.overall.delta)} ${sign(delta.overall.delta)} |`);
  lines.push('');

  // ── Summary counts ─────────────────────────────────────────────────────
  if (delta.regressions.length > 0 || delta.improvements.length > 0) {
    lines.push('### Summary');
    lines.push('');
    if (delta.improvements.length > 0) {
      lines.push(`🟢 **${delta.improvements.length}** file(s) improved`);
    }
    if (delta.regressions.length > 0) {
      lines.push(`🔴 **${delta.regressions.length}** file(s) regressed`);
    }
    lines.push('');
  }

  // ── Per-file table ─────────────────────────────────────────────────────
  const changedFiles = delta.files.filter(f => Math.abs(f.delta) > 0.01);

  if (changedFiles.length > 0) {
    lines.push('### Files Changed');
    lines.push('');
    lines.push('| File | Base | Head | Delta |');
    lines.push('|---|---|---|---|');

    for (const f of changedFiles) {
      const emoji = deltaEmoji(f.delta);
      // Shorten very long paths for readability
      const shortFile = f.file.replace(/^.*\/src\//, 'src/');
      lines.push(`| \`${shortFile}\` | ${fmt(f.basePct)} | ${fmt(f.headPct)} | ${emoji} ${sign(f.delta)} |`);
    }

    lines.push('');

    // ── Uncovered lines for regressed files ──────────────────────────────
    const regressedWithLines = changedFiles.filter(
      f => f.delta < -0.01 && f.uncoveredLines.length > 0
    );

    if (regressedWithLines.length > 0) {
      lines.push('### Uncovered Lines in Regressed Files');
      lines.push('');
      for (const f of regressedWithLines) {
        const shortFile = f.file.replace(/^.*\/src\//, 'src/');
        const lineList = f.uncoveredLines.slice(0, 20).join(', ');
        const suffix = f.uncoveredLines.length > 20
          ? ` … and ${f.uncoveredLines.length - 20} more`
          : '';
        lines.push(`- \`${shortFile}\`: lines ${lineList}${suffix}`);
      }
      lines.push('');
    }
  } else {
    lines.push('_No per-file coverage changes detected._');
    lines.push('');
  }

  lines.push('---');
  lines.push('_Coverage diff generated by [check-coverage.js](../scripts/check-coverage.js)_');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { diff: false, base: null, head: null, output: null };
  for (const arg of argv.slice(2)) {
    if (arg === '--diff') {
      args.diff = true;
    } else if (arg.startsWith('--base=')) {
      args.base = arg.slice(7);
    } else if (arg.startsWith('--head=')) {
      args.head = arg.slice(7);
    } else if (arg.startsWith('--output=')) {
      args.output = arg.slice(9);
    }
  }
  return args;
}

function runDiffMode(args) {
  const basePath = args.base || 'coverage/base-lcov.info';
  const headPath = args.head || 'coverage/lcov.info';
  const outputPath = args.output || 'coverage/diff-comment.md';

  console.log(`📊 Computing coverage delta: ${basePath} → ${headPath}`);

  const baseLcov = parseLcovFile(basePath);
  const headLcov = parseLcovFile(headPath);
  const delta = computeCoverageDelta(baseLcov, headLcov);
  const comment = formatCoverageDiffComment(delta);

  // Write markdown to output file
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, comment, 'utf8');

  console.log(`✅ Diff comment written to ${outputPath}`);
  console.log(`   Overall: ${delta.overall.base.toFixed(2)}% → ${delta.overall.head.toFixed(2)}% (${delta.overall.delta >= 0 ? '+' : ''}${delta.overall.delta.toFixed(2)}%)`);
  if (delta.regressions.length > 0) {
    console.log(`   🔴 Regressions: ${delta.regressions.length} file(s)`);
  }
  if (delta.improvements.length > 0) {
    console.log(`   🟢 Improvements: ${delta.improvements.length} file(s)`);
  }
}

// Run
try {
  const args = parseArgs(process.argv);
  if (args.diff) {
    runDiffMode(args);
  } else {
    checkCoverage();
  }
} catch (error) {
  console.error('❌ Error checking coverage:', error.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Exports (for programmatic use and testing)
// ---------------------------------------------------------------------------

module.exports = {
  THRESHOLDS,
  checkCoverage,
  parseLcovFile,
  parseLcovSummary,
  computeCoverageDelta,
  formatCoverageDiffComment
};
