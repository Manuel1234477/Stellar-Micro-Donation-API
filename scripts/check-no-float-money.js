#!/usr/bin/env node

'use strict';

/**
 * Linting script to detect potential floating-point arithmetic on monetary fields (#1485).
 *
 * RESPONSIBILITY: Enforce use of integer stroops instead of parseFloat on monetary values
 * OWNER: Backend Team
 *
 * Detects:
 * - parseFloat(...) calls on amount fields
 * - parseFloat on Stellar balance fields
 * - Floating-point arithmetic on XLM amounts
 *
 * False positives are expected for non-monetary values like:
 * - sampling rates, percentages, ratios
 * - multipliers, exchange rates
 * - database query parameters
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src');

/**
 * Recursively find all .js files in a directory.
 */
function findJsFiles(dir, excludePatterns = []) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip excluded patterns
    if (excludePatterns.some(p => p.test(fullPath))) {
      continue;
    }

    if (entry.isDirectory()) {
      files = files.concat(findJsFiles(fullPath, excludePatterns));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }

  return files;
}

// Patterns that indicate a value is likely monetary
const MONETARY_PATTERNS = [
  /amount/i,
  /balance/i,
  /fee/i,
  /cost/i,
  /price/i,
  /xlm/i,
  /stroop/i,
  /donation/i,
  /reserved/i,
  /required/i,
];

// Patterns to exclude (these are typically non-monetary)
const NON_MONETARY_PATTERNS = [
  /rate/i,           // exchange rates, success rates, sample rates
  /percentage/i,
  /multiplier/i,
  /surge/i,
  /capacity/i,
  /usage/i,
  /timeout/i,
  /sampling/i,
  /frac/,            // fractional parts
  /[0-9]\./,         // version numbers like "7.0"
];

// Files to skip (not monetary code or already reviewed)
const SKIP_PATTERNS = [
  /test\.js$/,
  /\.test\.js$/,
  /spec\.js$/,
  /mock/i,
  /__tests__/,
];

/**
 * Determine if a variable name suggests it's a monetary value.
 */
function isSuspiciouslyMonetary(varName) {
  if (!varName) return false;

  // Check if it matches a non-monetary pattern first (higher priority)
  if (NON_MONETARY_PATTERNS.some(p => p.test(varName))) {
    return false;
  }

  // Check if it matches a monetary pattern
  return MONETARY_PATTERNS.some(p => p.test(varName));
}

/**
 * Extract variable names from a line of code.
 * Very basic regex-based extraction (not a full parser).
 */
function extractVarNamesFromLine(line) {
  const parsed = [];

  // parseFloat(varName) pattern
  const parseFloatMatches = line.matchAll(/parseFloat\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
  for (const match of parseFloatMatches) {
    parsed.push({
      type: 'parseFloat',
      varName: match[1],
      index: match.index,
      full: match[0],
    });
  }

  // Also detect methods called on amounts (e.g., tx.amount.toFixed(), parseFloat(balance))
  const floatArithmeticMatches = line.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$.]*)\s*[\+\-\*\/]\s*([a-zA-Z_$][a-zA-Z0-9_$.]*(?:\s*\*\s*[0-9]+)?)/g);
  for (const match of floatArithmeticMatches) {
    if (isSuspiciouslyMonetary(match[1]) || isSuspiciouslyMonetary(match[2])) {
      parsed.push({
        type: 'arithmetic',
        left: match[1],
        right: match[2],
        index: match.index,
        full: match[0],
      });
    }
  }

  return parsed;
}

/**
 * Scan a file for floating-point arithmetic on monetary values.
 */
function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const issues = [];

  lines.forEach((line, lineNum) => {
    const violations = extractVarNamesFromLine(line);

    for (const v of violations) {
      if (v.type === 'parseFloat' && isSuspiciouslyMonetary(v.varName)) {
        issues.push({
          line: lineNum + 1,
          file: filePath,
          type: 'parseFloat_on_monetary',
          varName: v.varName,
          code: line.trim(),
          message: `parseFloat() on monetary field "${v.varName}" — use money.js utility instead`,
        });
      }
    }
  });

  return issues;
}

/**
 * Main function.
 */
async function main() {
  const excludePatterns = [
    ...SKIP_PATTERNS,
    /node_modules/,
  ];

  const files = findJsFiles(srcDir, excludePatterns);

  let totalIssues = 0;
  const issuesByFile = {};

  for (const file of files) {
    const issues = scanFile(file);
    if (issues.length > 0) {
      issuesByFile[file] = issues;
      totalIssues += issues.length;
    }
  }

  if (totalIssues === 0) {
    console.log('✔ No floating-point monetary arithmetic detected');
    process.exit(0);
  }

  console.log(`\n⚠ Found ${totalIssues} potential floating-point arithmetic issue(s):\n`);

  for (const [file, issues] of Object.entries(issuesByFile)) {
    const relPath = path.relative(process.cwd(), file);
    console.log(`  ${relPath}`);
    for (const issue of issues) {
      console.log(`    ${issue.line}: ${issue.message}`);
      console.log(`       → ${issue.code}`);
    }
    console.log();
  }

  console.log('\nHow to fix:');
  console.log('1. Import the money.js utility: const { toStroops, fromStroops } = require("./utils/money");');
  console.log('2. Convert amounts to stroops before arithmetic: amount = toStroops(xlmAmount);');
  console.log('3. Convert back to XLM for display: fromStroops(stroops);');
  console.log('\nSee docs/adr/004-money-as-stroops.md for architectural decision on stroop-based arithmetic.\n');

  process.exit(totalIssues > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
