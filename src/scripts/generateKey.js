#!/usr/bin/env node
/**
 * generate-key — generate a stable ENCRYPTION_KEY and write it to .env
 *
 * Usage:
 *   npm run generate-key            # writes/updates ENCRYPTION_KEY in .env
 *   npm run generate-key -- --print # only prints the key, does not write
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');
const key = crypto.randomBytes(32).toString('hex');
const printOnly = process.argv.includes('--print');

if (printOnly) {
  console.log(key);
  process.exit(0);
}

// Write or update ENCRYPTION_KEY in .env
if (fs.existsSync(ENV_PATH)) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  if (/^ENCRYPTION_KEY\s*=/m.test(content)) {
    content = content.replace(/^ENCRYPTION_KEY\s*=.*/m, `ENCRYPTION_KEY=${key}`);
    console.log('✔ Updated ENCRYPTION_KEY in .env');
  } else {
    content += `\nENCRYPTION_KEY=${key}\n`;
    console.log('✔ Added ENCRYPTION_KEY to .env');
  }
  fs.writeFileSync(ENV_PATH, content);
} else {
  fs.writeFileSync(ENV_PATH, `ENCRYPTION_KEY=${key}\n`);
  console.log('✔ Created .env with ENCRYPTION_KEY');
}

console.log('\n⚠️  Keep this key secret and never commit it to version control.');
console.log('   Changing it will make all previously encrypted data unrecoverable.\n');
