#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-database-schema.js (Issue #1960)
 *
 * Generates docs/DATABASE_SCHEMA.md from a database built by running every
 * migration in src/migrations against an empty SQLite file. The schema is
 * therefore the one the code actually runs against, not a hand-written copy.
 *
 * Usage:
 *   node scripts/generate-database-schema.js          # rewrite the document
 *   node scripts/generate-database-schema.js --check  # exit 1 if out of date
 *
 * The output is deterministic: no timestamps, no SQLite version, sorted names.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'DATABASE_SCHEMA.md');

// Test-only fallbacks so the database layer can load without a full environment.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MOCK_STELLAR = process.env.MOCK_STELLAR || 'true';
process.env.API_KEYS = process.env.API_KEYS || 'schema-generator';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ||
  '0000000000000000000000000000000000000000000000000000000000000000';

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const cell = (value) => (value === null || value === undefined || value === '' ? '—' : String(value).replace(/\|/g, '\\|').replace(/\n/g, ' '));

/**
 * @param {Object} Database - Database module (already pointed at the temp file).
 * @returns {Promise<Array<Object>>} One object per table with columns, FKs and indexes.
 */
async function readSchema(Database) {
  const tables = await Database.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );

  const result = [];
  for (const { name } of tables) {
    const columns = await Database.all(`PRAGMA table_info(${quoteIdent(name)})`);
    const foreignKeys = await Database.all(`PRAGMA foreign_key_list(${quoteIdent(name)})`);
    const indexList = await Database.all(`PRAGMA index_list(${quoteIdent(name)})`);

    const indexes = [];
    for (const idx of indexList) {
      // Skip automatic indexes created for UNIQUE/PRIMARY KEY constraints.
      if (idx.name.startsWith('sqlite_autoindex_')) continue;
      const info = await Database.all(`PRAGMA index_info(${quoteIdent(idx.name)})`);
      indexes.push({
        name: idx.name,
        unique: Boolean(idx.unique),
        columns: info.sort((a, b) => a.seqno - b.seqno).map(c => c.name),
      });
    }
    indexes.sort((a, b) => a.name.localeCompare(b.name));

    result.push({
      name,
      columns,
      foreignKeys: foreignKeys.sort((a, b) => a.id - b.id || a.seq - b.seq),
      indexes,
    });
  }
  return result;
}

/**
 * Render the Markdown document.
 * @param {Array<Object>} tables - Output of readSchema().
 * @returns {string}
 */
function render(tables) {
  const relationships = tables.flatMap(t =>
    t.foreignKeys.map(fk => ({ child: t.name, parent: fk.table, column: fk.from })),
  );
  const indexCount = tables.reduce((n, t) => n + t.indexes.length, 0);

  const lines = [
    '# Database Schema',
    '',
    '<!-- AUTO-GENERATED — do not edit by hand.',
    '     Regenerate with: npm run docs:db-schema',
    '     Source: every migration in src/migrations, applied to an empty SQLite database.',
    '     CI verifies this file with: npm run docs:db-schema:check -->',
    '',
    'This document is generated from the migrations the application runs. The',
    'hand-written schema that used to live in the README drifted from the code, so it',
    'has been removed. For the amounts column rules see [ADR-004](adr/004-money-as-stroops.md).',
    '',
    'Limitation: a few tables are created lazily by model code at runtime rather than by a',
    'migration (for example `webhooks` and `matching_programs`). They are not listed here.',
    '',
    `**Tables:** ${tables.length} · **Indexes:** ${indexCount} · **Foreign keys:** ${relationships.length}`,
    '',
    '## Entity relationships',
    '',
    '```mermaid',
    'erDiagram',
  ];

  for (const rel of relationships) {
    lines.push(`    ${rel.parent} ||--o{ ${rel.child} : "${rel.column}"`);
  }
  if (relationships.length === 0) lines.push('    %% no foreign keys');
  lines.push('```', '', '## Tables', '');

  for (const table of tables) {
    lines.push(`### \`${table.name}\``, '');
    lines.push('| Column | Type | Not null | Default | Primary key |');
    lines.push('|--------|------|----------|---------|-------------|');
    for (const col of table.columns) {
      lines.push(
        `| \`${col.name}\` | ${cell(col.type)} | ${col.notnull ? 'yes' : 'no'} | ${cell(col.dflt_value)} | ${col.pk ? 'yes' : 'no'} |`,
      );
    }
    lines.push('');

    if (table.foreignKeys.length) {
      lines.push('**Foreign keys**', '');
      for (const fk of table.foreignKeys) {
        lines.push(`- \`${fk.from}\` → \`${fk.table}\`(\`${fk.to || 'id'}\`)`);
      }
      lines.push('');
    }

    if (table.indexes.length) {
      lines.push('**Indexes**', '');
      for (const idx of table.indexes) {
        const kind = idx.unique ? 'unique index' : 'index';
        lines.push(`- \`${idx.name}\` (${kind} on ${idx.columns.map(c => `\`${c}\``).join(', ')})`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

async function build() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-doc-'));
  process.env.DB_PATH = path.join(tmpDir, 'schema.db');

  const Database = require('../src/utils/database');
  const { runMigrations } = require('../src/utils/migrationRunner');

  try {
    await runMigrations();
    const tables = await readSchema(Database);
    return render(tables);
  } finally {
    await Database.close().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const check = process.argv.includes('--check');
  const next = await build();

  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== next) {
      console.error(`✗ ${path.relative(ROOT, OUT)} is out of date. Run: npm run docs:db-schema`);
      return 1;
    }
    console.log(`✓ ${path.relative(ROOT, OUT)} is up to date`);
    return 0;
  }

  fs.writeFileSync(OUT, next, 'utf8');
  console.log(`✓ Generated ${path.relative(ROOT, OUT)}`);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`✗ Schema generation failed: ${err.message}`);
    process.exit(1);
  });
