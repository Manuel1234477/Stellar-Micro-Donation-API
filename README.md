# Stellar Micro-Donation API

[![CI](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/workflows/CI/badge.svg)](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/actions/workflows/ci.yml)
[![Security Scan](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/workflows/Security%20Scan/badge.svg)](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/actions/workflows/security-scan.yml)
[![Container Security](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/workflows/Container%20Image%20Vulnerability%20Scan/badge.svg)](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/actions/workflows/container-scan.yml)

A Node.js/Express API for micro-donations on the Stellar network. It supports one-time donations, recurring donation schedules, wallet management, and donation analytics.

- [Quickstart](#quickstart)
- [Configuration](#configuration)
- [API](#api)
- [Development](#development)
- [Documentation](#documentation)
- [Contributing](#contributing)

## Quickstart

Requires Node.js 24 or later and npm 10 or later. With `MOCK_STELLAR=true` the API runs without a Stellar account or network access.

```bash
npm install
cp .env.example .env
```

Edit `.env` and set:

| Variable | Value |
|----------|-------|
| `MOCK_STELLAR` | `true` |
| `API_KEYS` | any local key, for example `dev_key_change_me` |
| `ENCRYPTION_KEY` | 64 hex characters from `npm run generate-key` |

Then initialise the database and start the server:

```bash
npm run init-db
npm start
```

For auto-reload while you edit code, run `npm run dev` instead of `npm start`.

Verify the server is running. The versioned health endpoint is `/api/v1/health`:

```bash
curl http://localhost:3000/api/v1/health
```

Create a donation (replace `dev_key_change_me` with your `API_KEYS` value):

```bash
curl -X POST http://localhost:3000/api/v1/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev_key_change_me" \
  -d '{
    "senderPublicKey": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "recipientPublicKey": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    "amount": "10.00"
  }'
```

The step-by-step guide, including troubleshooting, is in [docs/quickstart.md](docs/quickstart.md).

## Configuration

Settings are read from `.env` in the project root. The variables below are the ones most setups need. The full reference, with defaults and validation rules, is in [docs/configuration.md](docs/configuration.md).

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No (`3000`) | HTTP port, 1–65535 |
| `API_KEYS` | Yes, unless you use database-backed keys | Comma-separated legacy keys. Rejected after `LEGACY_API_KEYS_DISABLED_AFTER` (default `2026-12-31`); see [docs/migration-legacy-api-keys.md](docs/migration-legacy-api-keys.md) |
| `ENCRYPTION_KEY` | Yes in production | 64 hex characters. Generate with `npm run generate-key`. Changing it makes previously encrypted data unreadable |
| `STELLAR_NETWORK` | No (`testnet`) | `testnet`, `mainnet`, or `futurenet` |
| `MOCK_STELLAR` | No (`false`) | `true` disables all outbound Stellar calls. Use it for local development and CI |
| `HORIZON_URL` | No | Overrides the Horizon endpoint for the selected network |
| `DB_PATH` | No (`./data/stellar_donations.db`) | Location of the SQLite database file |

SQLite is a single-writer store. Run one API replica per database file. Do not share the database file across instances or place it on NFS or another network filesystem. Multi-instance and production topology guidance is in [docs/deployment.md](docs/deployment.md).

Check your configuration before starting:

```bash
npm run validate-env
```

## API

All endpoints are versioned under `/api/v1`. Authenticate every request with the `X-API-Key` header. Use `npm run keys:create` to create database-backed keys and `npm run keys:list` to list them. For roles and permissions, see [docs/authentication.md](docs/authentication.md) and [docs/permissions.md](docs/permissions.md).

| Area | Endpoints |
|------|-----------|
| Donations | `POST /api/v1/donations`, `GET /api/v1/donations`, `GET /api/v1/donations/recent`, `GET /api/v1/donations/:id`, `POST /api/v1/donations/verify` |
| Wallets | `POST /api/v1/wallets`, `GET /api/v1/wallets`, `GET /api/v1/wallets/:id`, `GET /api/v1/wallets/:publicKey/transactions` |
| Recurring donations | `POST /api/v1/stream/create`, `GET /api/v1/stream/schedules`, `GET /api/v1/stream/schedules/:id`, `DELETE /api/v1/stream/schedules/:id` |
| Statistics | `GET /api/v1/stats/daily`, `GET /api/v1/stats/weekly`, `GET /api/v1/stats/summary`, `GET /api/v1/stats/donors`, `GET /api/v1/stats/recipients` |
| Transactions | `GET /api/v1/transactions`, `POST /api/v1/transactions/sync` |
| Health | `GET /api/v1/health` |

- Endpoint reference with request and response shapes: [docs/api-reference.md](docs/api-reference.md)
- Machine-readable OpenAPI spec: [docs/openapi.json](docs/openapi.json)
- Copy-paste examples: [docs/api-examples.md](docs/api-examples.md) and [examples/API_CURL_EXAMPLES.md](examples/API_CURL_EXAMPLES.md)
- Postman collection: [examples/Stellar-Micro-Donation-API.postman_collection.json](examples/Stellar-Micro-Donation-API.postman_collection.json)

## Development

Run `npm run` to list every script. The commands contributors use most often are:

| Command | Purpose |
|---------|---------|
| `npm test` | Run the Jest test suite |
| `npm run test:coverage` | Run tests with coverage; `npm run check-coverage` enforces the thresholds |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run migrate` | Apply pending database migrations |
| `npm run openapi:check` | Verify the committed OpenAPI spec matches the route annotations |
| `npm run examples:validate` | Validate the example requests in `examples/` |
| `npm run check:docs` | Verify README and docs links, script references, and API paths |

Project layout:

```
src/        Application code: routes, services, middleware, migrations, utils
tests/      Jest test suites
scripts/    Maintenance, validation, and generation scripts
docs/       Reference documentation (start at docs/README.md)
examples/   Curl examples and the Postman collection
monitoring/ Prometheus alert rules and Grafana dashboards
```

For coverage and test conventions, see [docs/coverage-guide.md](docs/coverage-guide.md). For CI, see [docs/ci-pipeline.md](docs/ci-pipeline.md). For load tests, run `npm run test:load` and see [docs/load-testing.md](docs/load-testing.md).

## Documentation

The full documentation index is at [docs/README.md](docs/README.md). Frequently used guides:

- [Quickstart](docs/quickstart.md): first run, end to end
- [Configuration](docs/configuration.md): every environment variable
- [Architecture](docs/architecture/architecture.md): components and data flow
- [Deployment](docs/deployment.md) and [Production deployment](docs/production-deployment.md)
- [Troubleshooting](docs/developer-troubleshooting-guide.md) and [quick reference](docs/troubleshooting-quick-reference.md)
- [API key rotation](docs/api-key-rotation.md)
- [Stellar concepts](docs/stellar-concepts.md) for contributors new to Stellar

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. All CI checks must pass before merge. Report security vulnerabilities privately as described in [SECURITY.md](SECURITY.md); do not open public issues for them.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE).
