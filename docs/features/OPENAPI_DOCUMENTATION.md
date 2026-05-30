# OpenAPI Documentation

## Overview

The API exposes an interactive OpenAPI 3.0 specification via Swagger UI and a machine-readable JSON endpoint.

## Endpoints

| Path | Description |
|---|---|
| `GET /api/docs` | Interactive Swagger UI |
| `GET /api/openapi.json` | Raw OpenAPI 3.0 JSON spec |

## Covered Endpoints

The spec documents all core routes:

- **Donations** — `POST /donations`, `GET /donations`, `GET /donations/{id}`, `PATCH /donations/{id}/status`, `POST /donations/verify`, `GET /donations/limits`, `GET /donations/recent`
- **Wallets** — `POST /wallets`, `GET /wallets`, `GET /wallets/{id}`, `PATCH /wallets/{id}`, `GET /wallets/{publicKey}/transactions`
- **Stream** — `POST /stream/create`, `GET /stream/schedules`, `GET /stream/schedules/{id}`, `DELETE /stream/schedules/{id}`
- **Statistics** — `GET /stats/daily`, `GET /stats/weekly`, `GET /stats/summary`, `GET /stats/donors`, `GET /stats/recipients`
- **Transactions** — `GET /transactions`, `POST /transactions/sync`, `POST /transactions/multisig`, `POST /transactions/multisig/collect`

## Authentication

All endpoints require an API key passed in the `x-api-key` header.

## Adding Annotations

Annotations use `swagger-jsdoc` JSDoc format in route files:

```js
/**
 * @openapi
 * /my-endpoint:
 *   get:
 *     tags: [MyTag]
 *     summary: Short description
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 */
```

## CI Sync Check

Run `npm run openapi:check` to verify the committed spec matches the generated one:

```bash
npm run openapi:check
```

The check fails if `docs/openapi.json` is out of sync with the route annotations.
