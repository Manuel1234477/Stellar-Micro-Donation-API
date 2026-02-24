# Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                             │
│              (REST API Consumers)                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXPRESS APP                               │
│              (src/routes/app.js)                            │
│  - Middleware setup                                         │
│  - Route registration                                       │
│  - Error handling                                           │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Donation    │ │    Stats     │ │   Health     │
│   Routes    │ │    Routes    │ │   Check      │
│ (donation.js)│ │  (stats.js)  │ │              │
└──────┬───────┘ └──────┬───────┘ └──────────────┘
       │                │
       ▼                ▼
┌──────────────────────────────────────────────────┐
│              SERVICE LAYER                        │
│         (Business Logic)                         │
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │      StatsService.js                       │ │
│  │  - getDailyStats()                         │ │
│  │  - getWeeklyStats()                        │ │
│  │  - getSummaryStats()                       │ │
│  │  - getDonorStats()                         │ │
│  │  - getRecipientStats()                     │ │
│  └────────────────────────────────────────────┘ │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│              MODEL LAYER                         │
│         (Data Access)                           │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────┐    │
│  │  Transaction     │  │      User        │    │
│  │  Model           │  │      Model       │    │
│  │  - create()      │  │  - create()      │    │
│  │  - getAll()      │  │  - getAll()      │    │
│  │  - getById()     │  │  - getById()     │    │
│  │  - getByRange()  │  │  - getByWallet() │    │
│  └──────────────────┘  └──────────────────┘    │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│              DATA LAYER                          │
│         (JSON File Storage)                     │
│                                                  │
│  ┌──────────────────┐  ┌──────────────────┐    │
│  │  donations.json  │  │   users.json     │    │
│  │  - 14 records    │  │  - 3 records     │    │
│  │  - 2 weeks data  │  │  - User profiles │    │
│  └──────────────────┘  └──────────────────┘    │
└──────────────────────────────────────────────────┘
```

## Data Flow

### Creating a Donation
```
POST /donations
    │
    ▼
donation.js (Route Handler)
    │
    ├─ Validate input
    ├─ Check required fields
    │
    ▼
Transaction.create()
    │
    ├─ Load existing transactions
    ├─ Create new transaction object
    ├─ Add to array
    │
    ▼
Save to donations.json
    │
    ▼
Return 201 Created
```

### Getting Daily Stats
```
GET /stats/daily?startDate=...&endDate=...
    │
    ▼
stats.js (Route Handler)
    │
    ├─ Validate query parameters
    ├─ Parse dates
    ├─ Validate date range
    │
    ▼
StatsService.getDailyStats()
    │
    ├─ Load transactions from JSON
    ├─ Filter by date range
    ├─ Group by calendar day
    ├─ Calculate totals
    │
    ▼
Return aggregated data
    │
    ▼
Return 200 OK with JSON response
```

## Request/Response Flow

### Daily Stats Request
```
Request:
GET /stats/daily?startDate=2024-02-12&endDate=2024-02-22

Processing:
1. Parse query parameters
2. Validate dates
3. Load transactions from JSON
4. Filter transactions in date range
5. Group by day (YYYY-MM-DD)
6. Calculate daily totals
7. Sort chronologically

Response:
{
  "success": true,
  "data": [
    {
      "date": "2024-02-12",
      "totalVolume": 125,
      "transactionCount": 2,
      "transactions": [...]
    },
    ...
  ],
  "metadata": {
    "dateRange": {...},
    "totalDays": 11,
    "aggregationType": "daily"
  }
}
```

### Weekly Stats Request
```
Request:
GET /stats/weekly?startDate=2024-02-12&endDate=2024-02-22

Processing:
1. Parse query parameters
2. Validate dates
3. Load transactions from JSON
4. Filter transactions in date range
5. Group by ISO 8601 week
6. Calculate weekly totals
7. Sort by year and week

Response:
{
  "success": true,
  "data": [
    {
      "week": 7,
      "year": 2024,
      "weekStart": "2024-02-12",
      "weekEnd": "2024-02-18",
      "totalVolume": 550,
      "transactionCount": 7,
      "transactions": [...]
    },
    ...
  ],
  "metadata": {...}
}
```

## Configuration Flow

```
.env (Environment Variables)
    │
    ├─ STELLAR_NETWORK
    ├─ STELLAR_SECRET
    ├─ PORT
    └─ DB_PATH
    │
    ▼
stellar.js (Config Module)
    │
    ├─ Load from .env
    ├─ Set defaults
    │
    ▼
Used by:
├─ app.js (PORT)
├─ Transaction Model (DB_PATH)
└─ Other modules
```

## Error Handling Flow

```
Request
    │
    ▼
Route Handler
    │
    ├─ Validate input
    │   ├─ Missing params? → 400 Bad Request
    │   ├─ Invalid format? → 400 Bad Request
    │   └─ Invalid range? → 400 Bad Request
    │
    ├─ Call Service
    │   ├─ Service error? → 500 Internal Error
    │   └─ Success? → Continue
    │
    ▼
Return Response
    ├─ Success: 200/201 with data
    └─ Error: 400/404/500 with message
```

## Aggregation Algorithm

### Daily Aggregation
```
Input: transactions[], startDate, endDate

1. Filter transactions by date range
2. Create Map<dateKey, dailyStats>
3. For each transaction:
   - Extract date (YYYY-MM-DD)
   - Add to corresponding day bucket
   - Accumulate volume
   - Increment count
4. Convert Map to Array
5. Sort by date
6. Return results
```

### Weekly Aggregation
```
Input: transactions[], startDate, endDate

1. Filter transactions by date range
2. Create Map<weekKey, weeklyStats>
3. For each transaction:
   - Calculate ISO 8601 week number
   - Add to corresponding week bucket
   - Accumulate volume
   - Increment count
4. Convert Map to Array
5. Sort by year, then week
6. Return results
```

## Performance Characteristics

### Time Complexity
- Daily Stats: O(n) where n = transactions in range
- Weekly Stats: O(n) where n = transactions in range
- Summary Stats: O(n) where n = transactions in range
- Donor Stats: O(n) where n = transactions in range
- Recipient Stats: O(n) where n = transactions in range

### Space Complexity
- O(n) for storing results
- O(d) for daily aggregation where d = days in range
- O(w) for weekly aggregation where w = weeks in range

### Scalability
- Current: Suitable for up to 100k transactions
- Bottleneck: File I/O and in-memory aggregation
- Solution: Implement database indexing for larger datasets

## Extension Points

### Adding New Aggregation Types
```javascript
// In StatsService.js
static getMonthlyStats(startDate, endDate) {
  // Similar pattern to daily/weekly
  // Group by month (YYYY-MM)
  // Return monthly aggregation
}
```

### Adding New Endpoints
```javascript
// In stats.js
router.get('/monthly', (req, res) => {
  // Similar pattern to existing endpoints
  // Call StatsService.getMonthlyStats()
  // Return response
});
```

### Switching to Database
```javascript
// Replace Transaction.js with database queries
// Update StatsService to use database
// No changes needed to routes
```

## Security Considerations

### Current Implementation
- Input validation on all endpoints
- Date range validation
- Error messages don't expose internals
- No authentication (can be added)

### Future Enhancements
- Add JWT authentication
- Implement rate limiting
- Add request logging
- Implement CORS
- Add input sanitization
- Add request size limits

## Monitoring & Logging

### Current Implementation
- Request logging middleware
- Error logging
- Console output

### Future Enhancements
- Structured logging (Winston, Bunyan)
- Performance metrics
- Error tracking (Sentry)
- Health monitoring
- Database query logging
