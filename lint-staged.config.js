'use strict';

/**
 * lint-staged configuration (#2120). Runs on staged files only, so the hook
 * stays fast. Bypass with `git commit --no-verify` when necessary.
 *
 * `node --check` accepts a single file, so it runs once per file.
 */

const quote = (file) => JSON.stringify(file);

module.exports = {
  '*.js': (files) => [
    ...files.map((file) => `node --check ${quote(file)}`),
    `eslint --fix ${files.map(quote).join(' ')}`,
  ],
  // Placeholder-marker check on every staged file (#2121).
  '*': (files) => `node scripts/check-no-placeholders.js ${files.map(quote).join(' ')}`,
};
