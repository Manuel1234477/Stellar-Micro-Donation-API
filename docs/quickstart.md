# Quickstart Guide

Get the Stellar Micro-Donation API running locally in under 10 minutes.

## Prerequisites

- Node.js v14+
- npm
- Git

## 1. Clone & Install

```bash
git clone https://github.com/Manuel1234477/Stellar-Micro-Donation-API.git
cd Stellar-Micro-Donation-API
npm install
```

## 2. Configure Environment

```bash
cp .env.example .env
```

Minimum `.env` for local development:

```env
PORT=3000
STELLAR_NETWORK=testnet
MOCK_STELLAR=true
API_KEYS=dev_key_123
```

`MOCK_STELLAR=true` skips all real blockchain calls — no Stellar account needed.

## 3. Initialize Database & Start

```bash
npm run init-db
npm start
```

The API is now available at `http://localhost:3000`.

## 4. Verify It Works

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{ "status": "ok" }
```

## 5. Make Your First Donation

```bash
curl -X POST http://localhost:3000/api/v1/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev_key_123" \
  -d '{
    "senderPublicKey": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "recipientPublicKey": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    "amount": "10.00"
  }'
```

## 6. Run Tests

```bash
npm test
```

## Next Steps

- [API Reference](./api-reference.md) — all endpoints with request/response examples
- [Authentication Guide](./authentication.md) — API key setup and permissions
- [Architecture Overview](./architecture.md) — how the system fits together
- [Stellar Concepts](./stellar-concepts.md) — blockchain background for new contributors
- [Deployment Guide](./deployment.md) — Docker, bare metal, and cloud

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port in use | Set `PORT=3001` in `.env` |
| `API_KEYS` missing error | Add `API_KEYS=dev_key_123` to `.env` |
| Database errors | Run `npm run init-db` |
| Stellar network errors | Set `MOCK_STELLAR=true` in `.env` |
| Dependency issues | `rm -rf node_modules && npm install` |
