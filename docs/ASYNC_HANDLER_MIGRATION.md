# asyncHandler Migration Guide

Express 4.x does not catch errors thrown inside async route handlers. Without a wrapper, any `throw` or rejected `await` becomes an unhandled promise rejection and the client gets a connection reset instead of a proper error response.

## The wrapper

```js
// src/utils/asyncHandler.js
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
```

It forwards any rejection to Express's error-handling middleware (`next(err)`), which returns a structured JSON error response.

## Pattern for new route handlers

Always wrap async handlers with `asyncHandler`:

```js
const asyncHandler = require('../utils/asyncHandler');

// ✅ Correct
router.get('/example', asyncHandler(async (req, res) => {
  const data = await someAsyncOperation();
  res.json(data);
}));

// ❌ Wrong — unhandled rejection on throw
router.get('/example', async (req, res) => {
  const data = await someAsyncOperation();
  res.json(data);
});
```

Multi-line route calls follow the same rule:

```js
router.post(
  '/example',
  requireApiKey,
  validateSchema,
  asyncHandler(async (req, res) => {   // ← wrap here
    const result = await doWork(req.body);
    res.status(201).json(result);
  })
);
```

## Error handling inside handlers

You do **not** need a `try/catch` inside an `asyncHandler`-wrapped function unless you want to handle a specific error differently. Let unexpected errors propagate to the global error handler:

```js
// ✅ Let asyncHandler forward unexpected errors
router.get('/wallets/:id', asyncHandler(async (req, res) => {
  const wallet = await WalletService.getById(req.params.id);
  if (!wallet) return res.status(404).json({ error: 'Not found' });
  res.json(wallet);
}));

// ✅ Catch only what you can handle
router.post('/donations', asyncHandler(async (req, res) => {
  try {
    const result = await DonationService.create(req.body);
    res.status(201).json(result);
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    throw err; // re-throw — asyncHandler will forward to next(err)
  }
}));
```

## ESLint enforcement

The `local/require-async-handler` rule (in `eslint-rules/require-async-handler.js`) flags any async function passed directly as a route handler argument without `asyncHandler`. Running `npm run lint` will catch violations before they reach review.
