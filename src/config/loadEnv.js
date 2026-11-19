'use strict';

/**
 * Single loader for the repository `.env` file (#1943)
 *
 * RESPONSIBILITY: Load the documented environment file (<repo>/.env) exactly
 *   once, and warn when a stray `src/.env` exists, because that file is ignored.
 * OWNER: Platform Team
 * DEPENDENCIES: dotenv
 *
 * Only configuration modules and process entry points should require this
 * module. Utility modules (for example src/utils/database.js) must not load
 * environment files themselves: the result would depend on require order.
 *
 * dotenv never overrides variables that are already set in process.env, so
 * repeated requires are harmless; Node's module cache makes this load once.
 */

const fs = require('fs');
const path = require('path');

const ROOT_ENV_PATH = path.join(__dirname, '..', '..', '.env');
const LEGACY_SRC_ENV_PATH = path.join(__dirname, '..', '.env');

require('dotenv').config({ path: ROOT_ENV_PATH });

if (fs.existsSync(LEGACY_SRC_ENV_PATH)) {
  // Use emitWarning rather than the logger: the logger depends on config, which
  // depends on this module, so requiring it here would create a cycle.
  process.emitWarning(
    `Ignoring ${LEGACY_SRC_ENV_PATH}. Environment configuration is read only from the repository-root .env file; move any settings from src/.env into ${ROOT_ENV_PATH}.`,
    { type: 'ConfigWarning', code: 'LEGACY_SRC_ENV_IGNORED' },
  );
}

module.exports = { ROOT_ENV_PATH, LEGACY_SRC_ENV_PATH };
