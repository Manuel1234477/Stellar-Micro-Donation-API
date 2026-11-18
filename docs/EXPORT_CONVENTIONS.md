# Module Export Conventions

This document establishes consistent export patterns across the codebase to improve discoverability, enable better tree-shaking, and reduce friction during imports.

## Core Principles

1. **Clarity**: Consumers understand what's exported at a glance
2. **Consistency**: Same module types export in predictable ways
3. **Tooling**: Linters and IDE autocomplete work reliably
4. **Tree-shaking**: Bundlers can safely remove unused code

## Export Patterns by Module Type

### Services & Classes

Services and classes (singletons or constructors) are exported directly.

**Pattern:**
```javascript
module.exports = ClassName;
// or for singletons:
module.exports = serviceInstance;
```

**Examples:**
- `src/services/StellarService.js` → `module.exports = StellarService`
- `src/services/WebhookService.js` → `module.exports = WebhookService`
- `src/utils/database.js` → `module.exports = Database` (singleton)

**When to use:**
- Instantiable classes
- Service objects with methods
- Utility objects with shared state

### Middleware & Handlers

Functions that are middleware or request handlers are exported as named properties in an object (or as the default function if there's only one).

**Pattern:**
```javascript
// Single middleware:
module.exports = requireAsyncHandler;

// Multiple related functions:
module.exports = {
  checkPermission,
  checkAnyPermission,
  checkAllPermissions,
  requireAdmin,
  attachUserRole,
};
```

**Examples:**
- `src/middleware/rbac.js` → Named exports for each checker
- `src/middleware/cors.js` → `module.exports` with main function + helpers

### Routes

Express routers are exported directly.

**Pattern:**
```javascript
module.exports = router;

// When the module also exposes test hooks or helpers, include `router`:
module.exports = { router, setService };
```

**Examples:**
- `src/routes/wallets/index.js` → `module.exports = router`
- `src/routes/network.js` → `module.exports = { router, setService }`

`helpers.js` files inside `src/routes/` (shared schemas and helpers, not routers)
follow the **Utilities & Helpers** convention.

### Utilities & Helpers

Pure functions and utility helpers are exported as named properties in an object.

**Pattern:**
```javascript
module.exports = {
  validateDonation,
  calculateFee,
  buildResponse,
  parseQueryParams,
};
```

**Rationale:**
- Enables IDE autocomplete
- Makes unused exports visible in code review
- Supports destructuring at import sites

**Examples:**
- `src/utils/validators.js` → Named exports for each validator
- `src/utils/response.js` → Named exports for response formatters

### Database/Data Access

Singletons providing database connections or query interfaces.

**Pattern:**
```javascript
module.exports = Database;  // Class with static/instance methods

// or for direct access:
const db = createDatabaseConnection();
module.exports = db;
```

### Migrations

Database migrations use their special format (must match framework expectations).

**Pattern:**
```javascript
exports.name = '048_example_change';
exports.up = async (db) => { /* ... */ };
exports.down = async (db) => { /* ... */ };
```

Every migration must export `name`, `up` and `down`. Do not use
`module.exports = { ... }` in migrations: one shape lets the migration runner and
the down-migration checker load every file the same way.

Do not rewrite migrations that have already shipped just to change their style.
The runner checksums each applied file and warns when its content changes.

### Configuration

Configuration modules export a plain object.

**Pattern:**
```javascript
module.exports = {
  database: { /* ... */ },
  server: { /* ... */ },
  security: { /* ... */ },
};
```

### Enums & Constants

Export as named properties in a frozen object.

**Pattern:**
```javascript
module.exports = Object.freeze({
  STATUS_PENDING: 'pending',
  STATUS_COMPLETE: 'complete',
  STATUS_FAILED: 'failed',
});
```

## Import Examples

Once standardized, imports become consistent:

```javascript
// Services (direct):
const StellarService = require('../services/StellarService');
const service = new StellarService();

// Singletons (direct):
const Database = require('../utils/database');
Database.query('SELECT ...');

// Utilities (named/destructured):
const { validateDonation, calculateFee } = require('../utils/validators');

// Middleware (named):
const { checkPermission, requireAdmin } = require('../middleware/rbac');

// Routes (direct):
const router = require('../routes/donations');
app.use('/donations', router);
```

## Enforcement

### ESLint Rule

An ESLint rule (`local/consistent-exports`) enforces compliance:
- Errors if a module mixes `module.exports = ...` with `exports.x = ...`
- Errors if a service wraps a single class in an object (`module.exports = { Foo }`)
- Errors if a route module exports an object without a `router` property
- Errors if a migration uses `module.exports` or is missing `name`, `up` or `down`
- Skips a module whose `module.exports` line has an `EXPORT_CONVENTION_EXCEPTION` comment directly above it

### CI Checks

Run linter in CI/CD to catch violations early:
```bash
npm run lint
```

## Migration Strategy

To migrate the codebase:

1. **Phase 1:** High-impact modules (services, utilities)
   - Core utils: `database.js`, `validators.js`, `encryption.js`
   - Common services: `StellarService.js`, `WebhookService.js`

2. **Phase 2:** Middleware and routes
   - Middleware modules with multiple functions
   - Route definitions

3. **Phase 3:** Remaining utilities
   - Small helpers, specialized utilities

4. **Phase 4:** Update all imports across the codebase

Each phase updates tests to maintain coverage.

## Exceptions & Comments

If a module must deviate from these conventions, document the reason:

```javascript
// EXPORT_CONVENTION_EXCEPTION: Legacy format required by ORM compatibility
// See issue #XXXX for migration plan
module.exports = legacyFormat;
```

## References

- [CommonJS Modules](https://nodejs.org/api/modules.html)
- [ES6 Module Interop](https://nodejs.org/api/esm.html#commonjs)
- [Tree Shaking in Webpack](https://webpack.js.org/guides/tree-shaking/)
