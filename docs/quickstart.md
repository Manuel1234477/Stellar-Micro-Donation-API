# Quickstart Guide

Get the Stellar Micro-Donation API running locally in under 10 minutes.

## Prerequisites

- **Node.js v20 or higher** (`node --version` must print `v20.x.x` or later)
- **npm v10 or higher**
- **Git**
- **SQLite3** (usually pre-installed on macOS and most Linux distributions)

> **Verify your Node version:**
> ```bash
> node --version   # must be ≥ v20.0.0
> npm --version    # must be ≥ v10.0.0
> ```

---

## 1. Clone & Install

```bash
git clone https://github.com/Manuel1234477/Stellar-Micro-Donation-API.git
cd Stellar-Micro-Donation-API
npm install
```

---

## 2. Generate an Encryption Key

The API requires a 64-character hex encryption key for memo encryption and sensitive data at rest.

```bash
npm run generate-key
```

Copy the printed value — you will need it in the next step.

---

## 3. Configure Environment

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
PORT=3000
STELLAR_NETWORK=testnet
MOCK_STELLAR=true
API_KEYS=dev_key_123
ENCRYPTION_KEY=<paste the 64-char hex value from step 2 here>
```

`MOCK_STELLAR=true` skips all real blockchain calls — no Stellar account or funded wallet is needed for local development.

---

## 4. Initialize & Migrate the Database

**Initialize** (creates the database file and base tables):

```bash
npm run init-db
```

**Run migrations** (applies all incremental schema changes):

```bash
npm run migrate
```

Both commands are idempotent — safe to re-run.

---

## 5. Start the Server

```bash
npm start
```

The API is now available at `http://localhost:3000`.

Expected output:
```
Server running on port 3000
Mock Stellar mode: enabled
```

> For development with auto-reload on file changes, use `npm run dev` instead.

---

## 6. Verify It Works

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{ "status": "ok" }
```

---

## 7. Make Your First Donation

```bash
curl -s -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev_key_123" \
  -d '{
    "senderPublicKey": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "recipientPublicKey": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    "amount": "10.00"
  }' | jq .
```

A successful response returns HTTP 201 with the created donation object:

```json
{
  "id": 1,
  "senderPublicKey": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "recipientPublicKey": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  "amount": 10,
  "status": "completed",
  ...
}
```

> **Note:** The base path for the API is `/` (no `/api/v1` prefix). Use `/donations`, `/wallets`, `/health`, etc.

---

## 8. Run the Test Suite

```bash
npm test
```

All tests use an isolated in-memory SQLite database — no cleanup needed between runs.

---

## Next Steps

- [API Reference](./api-reference.md) — all endpoints with request/response examples
- [API Examples](./API_EXAMPLES.md) — copy-paste curl commands for every flow
- [Authentication Guide](./authentication.md) — API key setup and RBAC
- [Architecture Overview](./architecture.md) — how the system fits together
- [SEP Compliance](./SEP_COMPLIANCE.md) — SEP-10 web auth and federation
- [Database Schema](./DATABASE_SCHEMA.md) — ER diagram and per-table column reference
- [Stellar Concepts](./stellar-concepts.md) — blockchain background for new contributors
- [Deployment Guide](./deployment.md) — Docker, bare metal, and cloud

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `node: version must be ≥ 20` | Install Node.js 20+ from https://nodejs.org |
| Port in use | Set `PORT=3001` in `.env` |
| `API_KEYS` missing error | Add `API_KEYS=dev_key_123` to `.env` |
| `ENCRYPTION_KEY is required` | Run `npm run generate-key` and add the value to `.env` |
| `SQLITE_ERROR: no such table` | Run `npm run init-db && npm run migrate` |
| Stellar network errors | Set `MOCK_STELLAR=true` in `.env` |
| Dependency issues | `rm -rf node_modules && npm install` |
| `npm start` exits immediately | Run `npm run validate-env` to see which variables are missing |

For a comprehensive troubleshooting guide, see [docs/DEVELOPER_TROUBLESHOOTING_GUIDE.md](./DEVELOPER_TROUBLESHOOTING_GUIDE.md).
