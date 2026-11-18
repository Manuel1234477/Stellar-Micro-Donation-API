# Quick Start Guide

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Initialize Database
```bash
npm run init-db
```

This creates sample donation data spanning two weeks with various donors and recipients.

### 3. Start the Server
```bash
npm start
```

### 4. Lint the Code
```bash
npm run lint
```

The API will be available at `http://localhost:3000`

## API Authentication

All API requests require authentication via API key:

```bash
# Add the X-API-Key header to all requests
curl -X GET "http://localhost:3000/api/v1/donations" \
  -H "X-API-Key: your-api-key-here"
```

For development, generate an API key using the admin endpoints or check `.env` for test credentials.

## Testing the Donation API

### Health Check
```bash
curl http://localhost:3000/health
```

### Create a Donation
```bash
curl -X POST http://localhost:3000/api/v1/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{
    "amount": 100,
    "donorId": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEEN2VTTMVU2GGKHAQZ7EWHN",
    "recipientId": "GCAG2JOYQAOPMSXLH5VG3JYMFP54MGSBKPXF2JHHB2WKI2EYVQQ42ER"
  }'
```

### Get Donations
```bash
curl -X GET "http://localhost:3000/api/v1/donations" \
  -H "X-API-Key: your-api-key-here"
```

### Get a Specific Donation
```bash
curl -X GET "http://localhost:3000/api/v1/donations/donation-id" \
  -H "X-API-Key: your-api-key-here"
```

### Get Recent Donations
```bash
curl -X GET "http://localhost:3000/api/v1/donations/recent" \
  -H "X-API-Key: your-api-key-here"
```

### Get Donation Limits
```bash
curl -X GET "http://localhost:3000/api/v1/donations/limits" \
  -H "X-API-Key: your-api-key-here"
```

### Verify a Transaction
```bash
curl -X POST "http://localhost:3000/api/v1/donations/verify" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{
    "transactionHash": "tx-hash-here"
  }'
```

### Update Donation Status
```bash
curl -X PATCH "http://localhost:3000/api/v1/donations/donation-id/status" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{
    "status": "completed"
  }'
```

## API Endpoints

All endpoints require the `/api/v1` prefix and `X-API-Key` header.

### Donations
- `POST /api/v1/donations` - Create a new donation (Rate limited: 10 req/min)
- `POST /api/v1/donations/send` - Send XLM and record donation (Rate limited: 10 req/min)
- `POST /api/v1/donations/verify` - Verify a transaction (Rate limited: 30 req/min)
- `GET /api/v1/donations` - Get all donations
- `GET /api/v1/donations/:id` - Get a specific donation
- `GET /api/v1/donations/recent` - Get recent donations
- `GET /api/v1/donations/limits` - Get donation amount limits
- `PATCH /api/v1/donations/:id/status` - Update donation status

### Rate Limiting
Donation creation and verification endpoints are rate limited to prevent abuse:
- Creation endpoints: 10 requests per minute per IP
- Verification endpoint: 30 requests per minute per IP
- Exceeded requests return HTTP 429 with retry information
- See [Rate Limiting Documentation](../RATE_LIMITING.md) for details

### Stats
- `GET /api/v1/stats/daily` - Daily aggregated volume
- `GET /api/v1/stats/weekly` - Weekly aggregated volume
- `GET /api/v1/stats/summary` - Overall summary statistics
- `GET /api/v1/stats/donors` - Stats grouped by donor
- `GET /api/v1/stats/recipients` - Stats grouped by recipient

## Sample Data

The database initialization script creates 14 sample donations across 2 weeks:

**Week 1 (Feb 12-15):**
- 7 transactions
- Total volume: 600 XLM

**Week 2 (Feb 19-22):**
- 7 transactions
- Total volume: 790 XLM

**Recipients:**
- GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEEN2VTTMVU2GGKHAQZ7EWHN
- GCAG2JOYQAOPMSXLH5VG3JYMFP54MGSBKPXF2JHHB2WKI2EYVQQ42ER
- GBBD47UZQ2KSYFIDRBAEX4NGGUD5WVGLL5FOKSTQTIFYIXOFT2FWGINX

## Troubleshooting

### Port Already in Use
Change the port in `.env`:
```
PORT=3001
```

### Database Not Found
Run the initialization script:
```bash
npm run init-db
```

### Authentication Errors
Ensure you're providing the `X-API-Key` header with all requests:
```bash
curl -H "X-API-Key: your-api-key-here" http://localhost:3000/api/v1/donations
```

### Invalid Stellar Address
Use valid Stellar public addresses (starting with 'G') for donor and recipient IDs:
```bash
# Valid Stellar address format
GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJEEN2VTTMVU2GGKHAQZ7EWHN
```

### Invalid Date Format
Use ISO format (YYYY-MM-DD or ISO 8601):
```bash
# Valid
?startDate=2024-02-12&endDate=2024-02-22

# Also valid
?startDate=2024-02-12T00:00:00Z&endDate=2024-02-22T23:59:59Z
```

## Next Steps

1. Review the [Configuration Guide](../CONFIGURATION.md) for environment setup
2. Review [Rate Limiting Documentation](../RATE_LIMITING.md) for API rate limits
3. Explore the sample data in `data/` directory
4. Check [API Examples](../../examples/API_CURL_EXAMPLES.md) for more use cases
5. Review [Production Deployment Guide](../PRODUCTION_DEPLOYMENT.md) when ready to deploy
