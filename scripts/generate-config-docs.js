#!/usr/bin/env node
'use strict';

/**
 * generate-config-docs.js (#1784, #1785)
 *
 * Generates, from src/config/envSchema.js:
 *   - .env.example (whole file)
 *   - the variable reference in docs/CONFIGURATION.md (between the
 *     BEGIN/END GENERATED markers; prose outside the markers is kept)
 *
 * Usage:
 *   node scripts/generate-config-docs.js           # write files
 *   node scripts/generate-config-docs.js --check   # exit 1 if files are stale
 */

const fs = require('fs');
const path = require('path');
const { ENV_VARS, ENV_VAR_PATTERNS, GROUPS } = require('../src/config/envSchema');

const ROOT = path.join(__dirname, '..');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');
const CONFIG_MD_PATH = path.join(ROOT, 'docs', 'CONFIGURATION.md');

const BEGIN_MARKER = '<!-- BEGIN GENERATED: env reference — edit src/config/envSchema.js, then run `npm run config:generate` -->';
const END_MARKER = '<!-- END GENERATED: env reference -->';

// ── helpers ──────────────────────────────────────────────────────────────────

/** GitHub-style heading anchor. */
function anchor(text) {
  return text.toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ /g, '-');
}

function wrap(text, width = 86) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && (line + ' ' + w).length > width) {
      lines.push(line);
      line = w;
    } else {
      line = line ? line + ' ' + w : w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function hasDefault(def) {
  return def.default !== undefined && def.default !== null;
}

function typeLabel(def) {
  if (def.type === 'enum') return `enum (${def.enum.join(' \\| ')})`;
  if (def.type === 'list') return 'list (comma-separated)';
  return def.type;
}

function requiredLabel(def) {
  if (def.required === 'always') return '**yes**';
  if (def.required === 'production') return '**production**';
  return 'no';
}

function constraints(def) {
  const parts = [];
  if (def.min !== undefined && def.max !== undefined) parts.push(`Range: ${def.min}–${def.max}.`);
  else if (def.min !== undefined) parts.push(`Minimum: ${def.min}.`);
  else if (def.max !== undefined) parts.push(`Maximum: ${def.max}.`);
  if (def.secret) parts.push('Secret.');
  if (def.deprecated) parts.push(`**Deprecated** — ${def.deprecated}.`);
  return parts.join(' ');
}

function mdEscape(text) {
  return String(text).replace(/\|/g, '\\|');
}

// ── .env.example ─────────────────────────────────────────────────────────────

function renderEnvExample() {
  const out = [
    '# =====================================',
    '# Stellar Micro-Donation API — .env.example',
    '#',
    '# GENERATED FILE — do not edit by hand.',
    '# Source: src/config/envSchema.js. Regenerate with: npm run config:generate',
    '#',
    '# Copy this file to .env and fill in the values:',
    '#   cp .env.example .env',
    '#',
    '# Variables marked REQUIRED must be set before the server will start.',
    '# Variables marked OPTIONAL have safe defaults and can be left commented.',
    '# Full documentation: docs/CONFIGURATION.md',
    '# =====================================',
  ];

  for (const group of GROUPS) {
    out.push('', '', '# =====================================', `# ${group}`, '# =====================================');
    for (const def of ENV_VARS.filter((v) => v.group === group)) {
      out.push('');
      for (const line of wrap(def.description.replace(/\*\*/g, ''))) out.push(`# ${line}`);
      if (def.type === 'enum') out.push(`# Allowed: ${def.enum.join(', ')}`);
      if (def.deprecated) out.push(`# DEPRECATED — ${def.deprecated}`);

      if (def.required === 'always') out.push('# REQUIRED');
      else if (def.required === 'production') out.push('# REQUIRED in production');
      else out.push(`# OPTIONAL${hasDefault(def) ? ` — default: ${def.default}` : ''}`);

      if (def.example !== undefined) {
        out.push(`${def.name}=${def.example}`);
      } else {
        const value = hasDefault(def) && !def.secret ? def.default : '';
        out.push(`# ${def.name}=${value}`);
      }
    }
  }

  for (const p of ENV_VAR_PATTERNS) {
    out.push('', `# ${p.description}`, `# Pattern: ${p.pattern.source}`);
  }

  return out.join('\n') + '\n';
}

// ── docs/CONFIGURATION.md ────────────────────────────────────────────────────

function renderReference() {
  const out = [BEGIN_MARKER, '', '## Contents', ''];
  GROUPS.forEach((group, i) => {
    const heading = `${i + 1}. ${group}`;
    out.push(`${i + 1}. [${group}](#${anchor(heading)})`);
  });
  out.push('', `${ENV_VARS.length} variables are declared. Further topics follow the reference below.`, '', '---');

  GROUPS.forEach((group, i) => {
    out.push('', `## ${i + 1}. ${group}`, '');
    out.push('| Variable | Type | Default | Required? | Effect |');
    out.push('|---|---|---|---|---|');
    for (const def of ENV_VARS.filter((v) => v.group === group)) {
      const dflt = hasDefault(def) ? `\`${mdEscape(def.default)}\`` : '—';
      const effect = [def.description, constraints(def)].filter(Boolean).join(' ');
      out.push(`| \`${def.name}\` | ${typeLabel(def)} | ${dflt} | ${requiredLabel(def)} | ${mdEscape(effect)} |`);
    }
    const patterns = ENV_VAR_PATTERNS.filter((p) => p.group === group);
    for (const p of patterns) {
      out.push(`| \`${mdEscape(p.pattern.source)}\` (pattern) | string | — | no | ${mdEscape(p.description)} |`);
    }
    out.push('', '---');
  });

  out.push('', END_MARKER);
  return out.join('\n');
}

function renderConfigMd(current) {
  const start = current.indexOf(BEGIN_MARKER);
  const end = current.indexOf(END_MARKER);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`docs/CONFIGURATION.md is missing the generated-section markers:\n  ${BEGIN_MARKER}\n  ${END_MARKER}`);
  }
  return current.slice(0, start) + renderReference() + current.slice(end + END_MARKER.length);
}

// ── main ─────────────────────────────────────────────────────────────────────

/**
 * @returns {Array<{file: string, expected: string, actual: string}>} files whose content differs
 */
function diffGeneratedFiles() {
  const stale = [];
  const envExample = renderEnvExample();
  const currentEnv = fs.existsSync(ENV_EXAMPLE_PATH) ? fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8') : '';
  if (currentEnv !== envExample) stale.push({ file: ENV_EXAMPLE_PATH, expected: envExample, actual: currentEnv });

  const currentMd = fs.readFileSync(CONFIG_MD_PATH, 'utf8');
  const md = renderConfigMd(currentMd);
  if (currentMd !== md) stale.push({ file: CONFIG_MD_PATH, expected: md, actual: currentMd });

  return stale;
}

function main() {
  const check = process.argv.includes('--check');
  const stale = diffGeneratedFiles();

  if (check) {
    if (stale.length) {
      for (const s of stale) console.error(`✖ ${path.relative(ROOT, s.file)} is out of date with src/config/envSchema.js`);
      console.error('Run `npm run config:generate` and commit the result.');
      process.exit(1);
    }
    console.log('✔ .env.example and docs/CONFIGURATION.md match src/config/envSchema.js');
    return;
  }

  for (const s of stale) {
    fs.writeFileSync(s.file, s.expected);
    console.log(`wrote ${path.relative(ROOT, s.file)}`);
  }
  if (!stale.length) console.log('Generated files already up to date.');
}

if (require.main === module) main();

module.exports = { renderEnvExample, renderReference, renderConfigMd, diffGeneratedFiles, BEGIN_MARKER, END_MARKER };
