# Async Handler Migration Guide

Express (pre-v5) does not automatically forward rejected promises or thrown errors from async route handlers to the error-handling middleware. This can lead to hung requests, lost correlation IDs, and unhandled promise rejections.

To prevent this, all async route handlers must be wrapped in the `asyncHandler` helper.

## How to use `asyncHandler`

1. Import the utility at the top of your route file:
   ```javascript
   const asyncHandler = require('../../utils/asyncHandler');
   ```

2. Wrap your async handlers when registering routes:
   ```javascript
   // Bad:
   router.get('/my-route', async (req, res) => { ... });

   // Good:
   router.get('/my-route', asyncHandler(async (req, res) => { ... }));
   ```

## Lint Rule Enforcer

The project configuration enforces this rule via a custom ESLint plugin rule: `local/require-async-handler`.

If you write an unwrapped async route handler, ESLint will report an error:
> Async route handler must be wrapped with asyncHandler(). See docs/async-handler-migration.md
