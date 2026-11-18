#!/usr/bin/env node
/**
 * check-i18n-orphans.js
 *
 * Ensures every canonical application error code has a static localized message.
 *
 * Exit 0 = clean (no orphaned files)
 * Exit 1 = orphaned files found
 */

'use strict';

const { ERROR_CODES } = require('../src/utils/errors');
const { MESSAGES } = require('../src/utils/i18n');

const messageKeys = new Set(Object.keys(MESSAGES));
const missingMessages = [...new Set(Object.values(ERROR_CODES).map(({ code }) => code))]
  .filter((code) => !messageKeys.has(code));

if (missingMessages.length > 0) {
  console.error('\n[check:i18n-orphans] FAIL — Error codes missing from the static message catalog:\n');
  for (const code of missingMessages) {
    console.error(`  ${code}`);
  }
  console.error('\nAdd a localized message in src/utils/i18n.js for each error code.\n');
  process.exit(1);
}

console.log(`[check:i18n-orphans] OK — All ${messageKeys.size} static message(s) cover the canonical error codes.`);
process.exit(0);
