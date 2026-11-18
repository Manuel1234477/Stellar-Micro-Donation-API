'use strict';

const path = require('path');

/**
 * Absolute repository root, independent of the importing test suite's directory.
 * Jest's rootDir is the repository root for the default configuration.
 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

module.exports = { REPO_ROOT };
