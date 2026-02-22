# Recent Donations Endpoint Documentation

## Overview
The `/donations/recent` endpoint provides a read-only, public-facing view of recent donations with all sensitive data stripped. This endpoint is designed for public dashboards, widgets, and transparency features.

## Endpoint Details

### URL
```
GET /donations/recent
```

### Base URL
```
http://localhost:3000/donations/recent
```

## Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 10 | 100 | Number of recent donations to return |

### Examples
```bash
# Get default 10 most recent donations
curl http://localhost:3000/donations/recent

# Get 5 most recent donations
curl http://localhost:3000/donations/recent?limit=5

# Get 50 most recent donations
curl http://localhost:3000/donations/recent?limit=50

# Requesting more than max (100) returns max
curl http://localhost:3000/donations/recent?limit=200  # Returns 100 records
```

## Response Format

### Success Response (200 OK)
```json
{
  "success": true,
  "data": [
    {
      "id": "14",
      "amount": 175,
      "donor": "Noah",
      "recipient": "Red Cross",
      "timestamp": "2024-02-22T11:15:00.000Z",
      "status": "completed"
    },
    {
      "id": "13",
      "amount": 55,
      "donor": "Mia",
      "recipient": "WHO",
      "timestamp": "2024-02-21T16:00:00.000Z",
      "status": "completed"
    }
  ],
  "count": 2,
  "limit": 2
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Indicates successful request |
| `data` | array | Array of donation objects |
| `count` | integer | Number of donations returned |
| `limit` | integer | Limit parameter used |

### Donation Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique donation identifier |
| `amount` | number | Donation amount in XLM |
| `donor` | string | Donor name (or "Anonymous") |
| `recipient` | string | Recipient organization |
| `timestamp` | string | ISO 8601 timestamp of donation |
| `status` | string | Donation status (always "completed") |

### Error Response (400 Bad Request)
```json
{
  "error": "Invalid limit parameter. Must be a positive number."
}
```

### Error Response (500 Internal Server Error)
```json
{
  "error": "Failed to retrieve recent donations",
  "message": "Error details here"
}
```

## Security Features

### ✅ No Sensitive Data Exposed
- **Stellar Transaction IDs** (`stellarTxId`) are NOT included in the response
- **Private keys** are never exposed
- **Secret keys** are never exposed
- **Wallet addresses** are not included

### ✅ Data Sanitization
The endpoint explicitly removes all sensitive fields before returning data:
```javascript
const sanitizedTransactions = sortedTransactions.map(tx => ({
  id: tx.id,
  amount: tx.amount,
  donor: tx.donor,
  recipient: tx.recipient,
  timestamp: tx.timestamp,
  status: tx.status
  // stellarTxId is intentionally excluded
}));
```

## Sorting

Donations are sorted by **most recent first** (descending timestamp order):
- Most recent donation appears first in the array
- Sorted by ISO 8601 timestamp
- Consistent ordering regardless of database order

## Rate Limiting

Currently no rate limiting is enforced. For production deployments, consider implementing:
- IP-based rate limiting
- Request throttling
- Caching strategies

## Use Cases

1. **Public Donation Dashboard** - Display recent donations on a website
2. **Transparency Widget** - Show donation activity in real-time
3. **Mobile App Integration** - Fetch recent donations for display
4. **Analytics Dashboard** - Track donation trends
5. **Social Proof** - Display recent donations to encourage giving

## Example Usage

### JavaScript/Node.js
```javascript
const response = await fetch('http://localhost:3000/donations/recent?limit=5');
const data = await response.json();
console.log(data.data); // Array of 5 most recent donations
```

### Python
```python
import requests

response = requests.get('http://localhost:3000/donations/recent?limit=5')
donations = response.json()['data']
for donation in donations:
    print(f"{donation['donor']} donated {donation['amount']} XLM to {donation['recipient']}")
```

### cURL
```bash
curl -X GET "http://localhost:3000/donations/recent?limit=10" \
  -H "Content-Type: application/json"
```

## Acceptance Criteria - Verification

✅ **No private keys or secrets exposed**
- Verified: `stellarTxId` and all sensitive fields are stripped
- Only public donation information is returned

✅ **Sorted by most recent**
- Verified: Donations sorted by timestamp in descending order
- Most recent donation appears first

✅ **Optional limit parameter**
- Verified: `?limit=X` parameter works
- Default: 10 donations
- Maximum: 100 donations
- Invalid values return error

## Testing

### Test Default Limit
```bash
curl http://localhost:3000/donations/recent | jq '.count'
# Expected: 10
```

### Test Custom Limit
```bash
curl http://localhost:3000/donations/recent?limit=3 | jq '.count'
# Expected: 3
```

### Test Max Limit Enforcement
```bash
curl http://localhost:3000/donations/recent?limit=200 | jq '.limit'
# Expected: 100
```

### Test Sorting (Most Recent First)
```bash
curl http://localhost:3000/donations/recent?limit=2 | jq '.data[0].timestamp'
# Should be more recent than .data[1].timestamp
```

### Test No Sensitive Data
```bash
curl http://localhost:3000/donations/recent?limit=1 | jq '.data[0] | keys'
# Should NOT include: stellarTxId, secretKey, privateKey
```

## Implementation Details

### Location
- **File**: `src/routes/donation.js`
- **Route Handler**: Lines 57-95
- **Model**: `src/routes/models/transaction.js`

### Algorithm
1. Parse and validate `limit` query parameter
2. Load all transactions from database
3. Sort by timestamp (descending)
4. Slice to limit
5. Sanitize each transaction (remove sensitive fields)
6. Return formatted response

### Performance
- **Time Complexity**: O(n log n) where n = total transactions
- **Space Complexity**: O(limit)
- **Suitable for**: Up to 100k transactions

## Future Enhancements

- Add pagination support (offset/page)
- Add filtering by recipient or donor
- Add date range filtering
- Add caching layer
- Add CORS headers for cross-origin requests
- Add response compression
- Add request signing/verification
