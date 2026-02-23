# Stats API Documentation

## Overview
The Stats API provides aggregated donation statistics with support for daily, weekly, and custom aggregations. All data is aggregated from the JSON database and returned in structured JSON responses.

## Base URL
```
http://localhost:3000/stats
```

## Endpoints

### 1. Daily Stats
**Endpoint:** `GET /stats/daily`

Get aggregated donation volume grouped by day.

**Query Parameters:**
- `startDate` (required): Start date in ISO format (YYYY-MM-DD or ISO 8601)
- `endDate` (required): End date in ISO format (YYYY-MM-DD or ISO 8601)

**Example Request:**
```bash
curl "http://localhost:3000/stats/daily?startDate=2024-02-12&endDate=2024-02-22"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "date": "2024-02-12",
      "totalVolume": 125,
      "transactionCount": 2,
      "transactions": [
        {
          "id": "1",
          "amount": 50,
          "donor": "Alice",
          "recipient": "Red Cross",
          "timestamp": "2024-02-12T10:30:00.000Z"
        },
        {
          "id": "2",
          "amount": 75,
          "donor": "Bob",
          "recipient": "UNICEF",
          "timestamp": "2024-02-12T14:15:00.000Z"
        }
      ]
    },
    {
      "date": "2024-02-13",
      "totalVolume": 125,
      "transactionCount": 2,
      "transactions": [...]
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-12T00:00:00.000Z",
      "end": "2024-02-22T00:00:00.000Z"
    },
    "totalDays": 11,
    "aggregationType": "daily"
  }
}
```

---

### 2. Weekly Stats
**Endpoint:** `GET /stats/weekly`

Get aggregated donation volume grouped by week (ISO 8601 week numbering).

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Example Request:**
```bash
curl "http://localhost:3000/stats/weekly?startDate=2024-02-12&endDate=2024-02-22"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "week": 7,
      "year": 2024,
      "weekStart": "2024-02-12",
      "weekEnd": "2024-02-18",
      "totalVolume": 600,
      "transactionCount": 7,
      "transactions": [...]
    },
    {
      "week": 8,
      "year": 2024,
      "weekStart": "2024-02-19",
      "weekEnd": "2024-02-25",
      "totalVolume": 790,
      "transactionCount": 7,
      "transactions": [...]
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-12T00:00:00.000Z",
      "end": "2024-02-22T00:00:00.000Z"
    },
    "totalWeeks": 2,
    "aggregationType": "weekly"
  }
}
```

---

### 3. Summary Stats
**Endpoint:** `GET /stats/summary`

Get overall summary statistics for a date range.

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Example Request:**
```bash
curl "http://localhost:3000/stats/summary?startDate=2024-02-12&endDate=2024-02-22"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "totalVolume": 1390,
    "totalTransactions": 14,
    "averageTransactionAmount": 99.29,
    "maxTransactionAmount": 200,
    "minTransactionAmount": 25,
    "dateRange": {
      "start": "2024-02-12T00:00:00.000Z",
      "end": "2024-02-22T00:00:00.000Z"
    }
  }
}
```

---

### 4. Donor Stats
**Endpoint:** `GET /stats/donors`

Get aggregated statistics grouped by donor, sorted by total donated (descending).

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Example Request:**
```bash
curl "http://localhost:3000/stats/donors?startDate=2024-02-12&endDate=2024-02-22"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "donor": "Jack",
      "totalDonated": 200,
      "donationCount": 1,
      "donations": [
        {
          "id": "10",
          "amount": 200,
          "recipient": "WHO",
          "timestamp": "2024-02-20T12:00:00.000Z"
        }
      ]
    },
    {
      "donor": "Noah",
      "totalDonated": 175,
      "donationCount": 1,
      "donations": [...]
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-12T00:00:00.000Z",
      "end": "2024-02-22T00:00:00.000Z"
    },
    "totalDonors": 14
  }
}
```

---

### 5. Recipient Stats
**Endpoint:** `GET /stats/recipients`

Get aggregated statistics grouped by recipient, sorted by total received (descending).

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Example Request:**
```bash
curl "http://localhost:3000/stats/recipients?startDate=2024-02-12&endDate=2024-02-22"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "recipient": "Red Cross",
      "totalReceived": 500,
      "donationCount": 5,
      "donations": [
        {
          "id": "1",
          "amount": 50,
          "donor": "Alice",
          "timestamp": "2024-02-12T10:30:00.000Z"
        }
      ]
    },
    {
      "recipient": "UNICEF",
      "totalReceived": 430,
      "donationCount": 4,
      "donations": [...]
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-12T00:00:00.000Z",
      "end": "2024-02-22T00:00:00.000Z"
    },
    "totalRecipients": 3
  }
}
```

---

## Error Handling

### Missing Query Parameters
**Status:** 400 Bad Request
```json
{
  "error": "Missing required query parameters: startDate, endDate (ISO format)"
}
```

### Invalid Date Format
**Status:** 400 Bad Request
```json
{
  "error": "Invalid date format. Use ISO format (YYYY-MM-DD or ISO 8601)"
}
```

### Invalid Date Range
**Status:** 400 Bad Request
```json
{
  "error": "startDate must be before endDate"
}
```

### Server Error
**Status:** 500 Internal Server Error
```json
{
  "error": "Failed to retrieve daily stats",
  "message": "Error details..."
}
```

---

## Usage Examples

### Get last 7 days of stats
```bash
# Calculate dates
START_DATE=$(date -d "7 days ago" +%Y-%m-%d)
END_DATE=$(date +%Y-%m-%d)

curl "http://localhost:3000/stats/daily?startDate=$START_DATE&endDate=$END_DATE"
```

### Get current month stats
```bash
curl "http://localhost:3000/stats/weekly?startDate=2024-02-01&endDate=2024-02-29"
```

### Get summary for a specific date range
```bash
curl "http://localhost:3000/stats/summary?startDate=2024-02-12&endDate=2024-02-22"
```

### Get top donors
```bash
curl "http://localhost:3000/stats/donors?startDate=2024-02-01&endDate=2024-02-29" | jq '.data | sort_by(.totalDonated) | reverse | .[0:5]'
```

---

## Data Aggregation Details

### Daily Aggregation
- Groups transactions by calendar day (YYYY-MM-DD)
- Returns total volume and transaction count per day
- Includes individual transaction details

### Weekly Aggregation
- Uses ISO 8601 week numbering (Week 1 = first week with Thursday in the year)
- Groups transactions by week number and year
- Returns week start/end dates for clarity
- Includes individual transaction details

### Summary Aggregation
- Calculates total volume across all transactions
- Computes average, min, and max transaction amounts
- Provides overall metrics for the date range

### Donor/Recipient Aggregation
- Groups by donor or recipient name
- Sorts by total amount (descending)
- Includes individual transaction details
- Handles "Anonymous" donors gracefully

---

## Performance Considerations

- All data is loaded from JSON files into memory
- Aggregations are computed on-demand
- For large datasets (>10k transactions), consider implementing pagination
- Date range queries are O(n) where n = total transactions
- Consider adding database indexing for production use

---

## Future Enhancements

1. **Pagination:** Add limit/offset for large result sets
2. **Filtering:** Filter by donor, recipient, or amount range
3. **Caching:** Cache aggregation results for frequently requested date ranges
4. **Real-time Updates:** WebSocket support for live stats
5. **Export:** CSV/Excel export functionality
6. **Custom Periods:** Support for custom aggregation periods (hourly, monthly, etc.)
