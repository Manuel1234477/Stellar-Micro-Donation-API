# Real-time Donation Leaderboard Feature

## Overview

This feature implements real-time donation leaderboards showing top donors and recipients. The leaderboards are updated in real-time as donations arrive and support different time periods (all-time, monthly, weekly, daily).

## Features

### API Endpoints

#### GET /leaderboard/donors
Returns the top donors ranked by total donations.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| period | string | 'all' | Time period: 'all', 'monthly', 'weekly', 'daily' |
| limit | number | 10 | Number of top donors to return (max: 100) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "donor": "GA1234567890",
      "totalDonated": 1000.50,
      "donationCount": 15,
      "lastDonationAt": "2024-01-15T10:30:00.000Z",
      "period": "all"
    }
  ],
  "metadata": {
    "period": "all",
    "limit": 10,
    "totalEntries": 10,
    "generatedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

#### GET /leaderboard/recipients
Returns the top recipients ranked by total received.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| period | string | 'all' | Time period: 'all', 'monthly', 'weekly', 'daily' |
| limit | number | 10 | Number of top recipients to return (max: 100) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "rank": 1,
      "recipient": "GB1234567890",
      "totalReceived": 5000.00,
      "donationCount": 42,
      "lastReceivedAt": "2024-01-15T10:30:00.000Z",
      "period": "all"
    }
  ],
  "metadata": {
    "period": "all",
    "limit": 10,
    "totalEntries": 10,
    "generatedAt": "2024-01-15T12:00:00.000Z"
  }
}
```

#### GET /leaderboard/stream
Server-Sent Events endpoint for real-time leaderboard updates.

**Headers:**
- `Last-Event-Id`: Optional. For reconnection to get missed events.

**Events:**
- `leaderboard.connected`: Initial connection confirmation
- `leaderboard.update`: Real-time leaderboard updates

## Implementation Details

### StatsService Methods

The `StatsService` class (in `src/routes/services/StatsService.js`) provides the following methods:

- `getDonorLeaderboard(period, limit)` - Get top donors leaderboard
- `getRecipientLeaderboard(period, limit)` - Get top recipients leaderboard
- `getDateRangeForPeriod(period)` - Get date range for a time period
- `invalidateLeaderboardCache()` - Invalidate all leaderboard caches

### Caching

Leaderboards are cached with a 1-minute TTL (60,000ms). Cache keys are structured as:
- `leaderboard:donors:{period}:{limit}`
- `leaderboard:recipients:{period}:{limit}`

### Cache Invalidation

When a new donation is confirmed:
1. The leaderboard cache is invalidated via `StatsService.invalidateLeaderboardCache()`
2. Updated leaderboards are computed and broadcast via SSE
3. Clients connected to the `/leaderboard/stream` endpoint receive the updates

### Real-time Updates via SSE

The `LeaderboardSSE` service (in `src/services/LeaderboardSSE.js`):
- Listens to `donation.confirmed` events
- Invalidates leaderboard cache
- Broadcasts updated leaderboards to all connected SSE clients

## Security Considerations

1. **Authentication**: All leaderboard endpoints require valid API key authentication
2. **Authorization**: Requires `STATS_READ` permission
3. **Input Validation**:
   - Period must be one of: 'all', 'monthly', 'weekly', 'daily'
   - Limit must be between 1 and 100
4. **Data Privacy**: Only confirmed transactions are included in leaderboards

## Testing

Run the tests:
```bash
npm test tests/implement-realtime-donation-leaderboard.test.js
```

The test suite covers:
- All success scenarios (empty leaderboard, populated leaderboard, filtering)
- Failure scenarios (invalid parameters, authentication failures)
- Edge cases (anonymous donors, missing recipients, invalid amounts)
- Cache behavior (caching, invalidation, TTL)
- Performance (handling large datasets, cache performance)

## Dependencies

- `uuid`: For generating unique SSE client IDs
- `Cache`: In-memory cache utility with TTL support
- `SseManager`: SSE connection management
- `donationEvents`: Event emitter for donation lifecycle events

## Configuration

No additional configuration required. The feature uses existing:
- Cache TTL (1 minute)
- Default limit (10)
- Max limit (100)

## Future Improvements

- Add support for filtering by campaign
- Implement persistent leaderboard storage
- Add historical leaderboard snapshots
- Support for custom time ranges