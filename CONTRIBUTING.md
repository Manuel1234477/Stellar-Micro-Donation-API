# Contributing Guide

Thanks for contributing to the Stellar Micro-Donation API!

## Getting Started

1. Fork the repo and clone your fork
2. Follow the [Quickstart Guide](docs/quickstart.md) to set up locally
3. Create a feature branch: `git checkout -b feature/your-feature-name`

## Development Workflow

```bash
npm install          # install dependencies
npm run init-db      # initialize database
npm start            # start server (http://localhost:3000)
npm run dev          # start with auto-reload
npm test             # run all tests
npm run lint         # check code style
```

Always use `MOCK_STELLAR=true` in your `.env` during development — no Stellar account needed.

## Code Style

- **ESLint** enforces style. Run `npm run lint` before committing.
- Use `const`/`let`, not `var`
- Async/await over raw Promise chains
- Add JSDoc comments to all exported functions:

```js
/**
 * Creates a donation record and submits it to the Stellar network.
 * @param {object} params - Donation parameters
 * @param {string} params.senderPublicKey - Sender's Stellar public key
 * @param {string} params.recipientPublicKey - Recipient's Stellar public key
 * @param {string} params.amount - Amount in XLM
 * @returns {Promise<object>} Created donation record
 */
async function createDonation(params) { ... }
```

## Testing Requirements

- **Minimum 95% coverage** for new code
- All tests must pass: `npm test`
- No live Stellar network in tests — use `MockStellarService`
- Tests must be isolated (no shared state between tests)
- Name test files to match the feature: `tests/your-feature.test.js`

```bash
npm run test:coverage    # run with coverage report
npm run check-coverage   # verify thresholds are met
```

### Writing Tests

```js
const request = require('supertest');
const app = require('../src/routes/app');

// Set mock mode before importing app
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test_key';

describe('My Feature', () => {
  it('should do the thing', async () => {
    const res = await request(app)
      .post('/api/v1/donations')
      .set('X-API-Key', 'test_key')
      .send({ ... });
    expect(res.status).toBe(201);
  });
});
```

## Pull Request Process

1. Ensure all tests pass and coverage thresholds are met
2. Run `npm run lint` — fix any issues
3. Write a clear PR description explaining what and why
4. Reference the issue number: `Closes #390`
5. Keep PRs focused — one feature or fix per PR

### PR Checklist

- [ ] Tests added/updated for all changes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run check-coverage` passes
- [ ] Documentation updated if needed
- [ ] No secrets or credentials in code

## Branch Naming

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/short-description` | `feature/add-webhook-support` |
| Bug fix | `fix/short-description` | `fix/scheduler-timezone-bug` |
| Docs | `docs/short-description` | `docs/update-api-reference` |

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add webhook notifications for completed donations
fix: handle missing memo field in transaction sync
docs: update quickstart with Docker instructions
test: add coverage for recurring donation edge cases
```

## Security

- Never commit secrets, API keys, or private keys
- Report security vulnerabilities privately via GitHub Security Advisories
- All inputs are sanitized — use the existing validation helpers in `src/utils/validationHelpers.js`
- See [Security Documentation](docs/security/) for threat model and security controls

## Questions?

- Open a [GitHub Discussion](../../discussions) for general questions
- Open an [Issue](../../issues) for bugs or feature requests
- Check [Troubleshooting Guide](docs/DEVELOPER_TROUBLESHOOTING_GUIDE.md) for common problems
