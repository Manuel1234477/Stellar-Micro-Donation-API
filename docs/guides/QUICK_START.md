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

## Testing the Stats API

### Health Check
```bash
curl http://localhost:3000/health
```

### Create a Donation
```bash
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 100,
    "donor": "John Doe",
    "recipient": "Red Cross"
  }'
```

### Get Daily Stats
```bash
curl "http://localhost:3000/stats/daily?startDate=2024-02-12&endDate=2024-02-22"
```

### Get Weekly Stats
```bash
curl "http://localhost:3000/stats/weekly?startDate=2024-02-12&endDate=2024-02-22"
```

### Get Summary Stats
```bash
curl "http://localhost:3000/stats/summary?startDate=2024-02-12&endDate=2024-02-22"
```

### Get Donor Stats
```bash
curl "http://localhost:3000/stats/donors?startDate=2024-02-12&endDate=2024-02-22"
```

### Get Recipient Stats
```bash
curl "http://localhost:3000/stats/recipients?startDate=2024-02-12&endDate=2024-02-22"
```

## Project Structure

```
src/
├── config/
│   └── stellar.js              # Configuration management
├── routes/
│   ├── app.js                  # Express app setup
│   ├── donation.js             # Donation endpoints
│   ├── stats.js                # Stats endpoints
│   ├── models/
│   │   ├── transaction.js      # Transaction model (JSON-based)
│   │   └── user.js             # User model (JSON-based)
│   └── services/
│       └── StatsService.js     # Stats aggregation logic
└── scripts/
    └── initDB.js               # Database initialization

data/
├── donations.json              # Donation transactions
└── users.json                  # User records
```

## API Endpoints

### Donations
- `POST /donations` - Create a new donation (Rate limited: 10 req/min)
- `POST /donations/send` - Send XLM and record donation (Rate limited: 10 req/min)
- `POST /donations/verify` - Verify a transaction (Rate limited: 30 req/min)
- `GET /donations` - Get all donations
- `GET /donations/:id` - Get a specific donation
- `GET /donations/recent` - Get recent donations
- `GET /donations/limits` - Get donation amount limits
- `PATCH /donations/:id/status` - Update donation status

### Rate Limiting
Donation creation and verification endpoints are rate limited to prevent abuse:
- Creation endpoints: 10 requests per minute per IP
- Verification endpoint: 30 requests per minute per IP
- Exceeded requests return HTTP 429 with retry information
- See [Rate Limiting Documentation](../features/RATE_LIMITING.md) for details

### Stats
- `GET /stats/daily` - Daily aggregated volume
- `GET /stats/weekly` - Weekly aggregated volume
- `GET /stats/summary` - Overall summary statistics
- `GET /stats/donors` - Stats grouped by donor
- `GET /stats/recipients` - Stats grouped by recipient

## Sample Data

The database initialization script creates 14 sample donations across 2 weeks:

**Week 1 (Feb 12-15):**
- 7 transactions
- Total volume: 600

**Week 2 (Feb 19-22):**
- 7 transactions
- Total volume: 790

**Recipients:**
- Red Cross: 500
- UNICEF: 430
- WHO: 460

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

### Invalid Date Format
Use ISO format (YYYY-MM-DD or ISO 8601):
```bash
# Valid
?startDate=2024-02-12&endDate=2024-02-22

# Also valid
?startDate=2024-02-12T00:00:00Z&endDate=2024-02-22T23:59:59Z
```

## Next Steps

1. Review `STATS_API.md` for detailed API documentation
2. Explore the sample data in `data/donations.json`
3. Implement additional features (filtering, pagination, etc.)
4. Connect to actual Stellar blockchain
5. Add authentication and authorization
