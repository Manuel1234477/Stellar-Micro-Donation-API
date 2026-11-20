'use strict';

/**
 * Database Utility - Data Access Layer (facade)
 *
 * RESPONSIBILITY: Public entry point for SQLite access. Re-exports the Database
 *   API that the rest of the codebase uses; the implementation is split across
 *   src/utils/database/*.js (#1944).
 * OWNER: Backend Team
 * DEPENDENCIES: src/utils/database/* (connection, pool, query, transaction,
 *   errors, diagnostics, health, lifecycle, shared)
 *
 * Callers keep using `require('../utils/database')` and the same static methods.
 * Each part is copied onto the Database class, so `this` inside every method is
 * Database at call time.
 */

const ConnectionMethods = require('./database/connection');
const DiagnosticsMethods = require('./database/diagnostics');
const ErrorsMethods = require('./database/errors');
const PoolMethods = require('./database/pool');
const QueryMethods = require('./database/query');
const TransactionMethods = require('./database/transaction');
const HealthMethods = require('./database/health');
const LifecycleMethods = require('./database/lifecycle');
// Top-level require: the database.js <-> tracing.js cycle is broken by
// src/utils/tracingHooks.js, which holds the shared tracer hooks and does not
// depend on this module. See #1988.
const tracingHooks = require('./tracingHooks');

class Database {}

const PARTS = [
  ConnectionMethods,
  DiagnosticsMethods,
  ErrorsMethods,
  PoolMethods,
  QueryMethods,
  TransactionMethods,
  HealthMethods,
  LifecycleMethods,
];

for (const part of PARTS) {
  for (const key of Object.getOwnPropertyNames(part)) {
    if (key === 'length' || key === 'name' || key === 'prototype') continue;
    Object.defineProperty(Database, key, Object.getOwnPropertyDescriptor(part, key));
  }
}

// Expose the shared tracing hooks on the facade so callers (and the tracing
// module) can reach them without requiring tracing.js from inside functions.
Database.tracingHooks = tracingHooks;

module.exports = Database;
