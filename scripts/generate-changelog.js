#!/usr/bin/env node
/**
 * scripts/generate-changelog.js
 *
 * Generates a changelog section from conventional commits since the last git tag
 * (or from the beginning of history if no tags exist).
 *
 * Usage:
 *   npm run changelog              # print unreleased entries to stdout
 *   npm run changelog -- --write  # prepend entries to CHANGELOG.md
 *
 * Conventional commit types recognised:
 *   feat, fix, perf, refactor, docs, test, chore, ci, build, style, revert
 *
 * Breaking changes: commits with "BREAKING CHANGE" in the body or "!" after
 * the type (e.g. "feat!: ...") are marked as breaking.
 */

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');
const REPO_URL = 'https://github.com/Manuel1234477/Stellar-Micro-Donation-API';

const TYPE_HEADINGS = {
  feat:     '### Added',
  fix:      '### Fixed',
  perf:     '### Performance',
  refactor: '### Changed',
  docs:     '### Documentation',
  test:     '### Tests',
  chore:    '### Chores',
  ci:       '### CI',
  build:    '### Build',
  style:    '### Style',
  revert:   '### Reverted',
};

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function getLastTag() {
  try {
    return run('git describe --tags --abbrev=0');
  } catch {
    return null;
  }
}

function getCommitsSince(tag) {
  const range = tag ? `${tag}..HEAD` : 'HEAD';
  const log = run(`git log ${range} --pretty=format:"%H|%s|%b|||" --no-merges`);
  if (!log) return [];

  return log.split('|||').map(raw => raw.trim()).filter(Boolean).map(entry => {
    const [hash, subject, ...bodyParts] = entry.split('|');
    return { hash: hash.trim(), subject: subject.trim(), body: bodyParts.join('|').trim() };
  });
}

function parseCommit({ hash, subject, body }) {
  // Match: type(scope)!: description  or  type!: description  or  type: description
  const match = subject.match(/^(\w+)(\([^)]+\))?(!)?\s*:\s*(.+)$/);
  if (!match) return null;

  const [, type, scope, bang, description] = match;
  const isBreaking = Boolean(bang) || /BREAKING CHANGE/i.test(body);
  const shortHash = hash.slice(0, 7);
  const scopeStr = scope ? scope.replace(/[()]/g, '') : null;

  return { type, scope: scopeStr, description, isBreaking, hash: shortHash };
}

function buildSection(commits, fromTag, toRef = 'HEAD') {
  const today = new Date().toISOString().slice(0, 10);
  const version = toRef === 'HEAD' ? 'Unreleased' : toRef;
  const compareUrl = fromTag
    ? `${REPO_URL}/compare/${fromTag}...${toRef === 'HEAD' ? 'HEAD' : toRef}`
    : `${REPO_URL}/commits/${toRef === 'HEAD' ? 'HEAD' : toRef}`;

  const breaking = [];
  const byType = {};

  for (const raw of commits) {
    const parsed = parseCommit(raw);
    if (!parsed) continue;

    if (parsed.isBreaking) {
      breaking.push(`- **BREAKING** ${parsed.description} (\`${parsed.hash}\`)`);
    }

    const heading = TYPE_HEADINGS[parsed.type];
    if (!heading) continue;

    byType[heading] = byType[heading] || [];
    const scopePart = parsed.scope ? `**${parsed.scope}**: ` : '';
    byType[heading].push(`- ${scopePart}${parsed.description} (\`${parsed.hash}\`)`);
  }

  const lines = [];
  lines.push(`## [${version}] - ${today}`);
  lines.push('');

  if (breaking.length) {
    lines.push('### ⚠ Breaking Changes');
    lines.push(...breaking);
    lines.push('');
  }

  for (const [heading, entries] of Object.entries(byType)) {
    lines.push(heading);
    lines.push(...entries);
    lines.push('');
  }

  if (!breaking.length && Object.keys(byType).length === 0) {
    lines.push('_No conventional commits found in this range._');
    lines.push('');
  }

  lines.push(`[${version}]: ${compareUrl}`);

  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const shouldWrite = args.includes('--write');

  const lastTag = getLastTag();
  const commits = getCommitsSince(lastTag);

  if (commits.length === 0) {
    console.log('No new commits since last tag.');
    return;
  }

  const section = buildSection(commits, lastTag);

  if (shouldWrite) {
    let existing = '';
    if (fs.existsSync(CHANGELOG_PATH)) {
      existing = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    }

    // Insert after the first heading line (# Changelog\n\n...)
    const insertAfter = '# Changelog\n';
    const idx = existing.indexOf(insertAfter);
    let updated;
    if (idx !== -1) {
      const after = existing.slice(idx + insertAfter.length).replace(/^\n+/, '');
      updated = `${insertAfter}\n${section}\n\n${after}`;
    } else {
      updated = `${section}\n\n${existing}`;
    }

    fs.writeFileSync(CHANGELOG_PATH, updated, 'utf8');
    console.log(`CHANGELOG.md updated with ${commits.length} commit(s).`);
  } else {
    console.log(section);
  }
}

main();
