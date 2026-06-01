# Cursor-Based Pagination: Stability and Concurrency

## Overview

The Stellar Micro-Donation API uses **keyset (cursor-based) pagination** for list endpoints. This document describes how pagination works, known limitations with concurrent inserts, and solutions for achieving consistent pagination behavior.

---

## How Cursor Pagination Works

Cursor pagination uses the keyset method to provide stable pagination across records. Instead of using offset/limit (which has performance and consistency issues), we encode the last record's position (timestamp + id) into an opaque cursor string.

### Current Implementation

- **Sort order**: Records are sorted by `timestamp DESC, id DESC` (newest first)
- **Cursor payload**: `{ timestamp: "2026-03-26T05:00:00Z", id: "123" }`
- **Cursor encoding**: Base64url-encoded JSON
- **Query parameters**:
  - `limit`: Page size (1–100, default 20)
  - `cursor`: Opaque position marker (returned in `next_cursor` or `prev_cursor`)
  - `direction`: `"next"` or `"prev"` for forward/backward pagination

### Example: Forward Pagination

```bash
# First request (no cursor)
GET /donations?limit=20
Response includes: next_cursor = "eyJ0aW1lc3RhbXAiOiIyMDI2LTAzLTI2VDA1OjAwOjAwWiIsImlkIjoiMjAifQ"

# Second request (use next_cursor)
GET /donations?limit=20&cursor=eyJ0aW1lc3RhbXAiOiIyMDI2LTAzLTI2VDA1OjAwOjAwWiIsImlkIjoiMjAifQ
```

The server applies: `WHERE (timestamp < ?) OR (timestamp = ? AND id < ?)`

---

## Known Limitation: Concurrent Inserts

### The Problem

When new records are inserted **between two pagination requests**, cursor pagination exhibits non-deterministic behavior:

1. **Records inserted before the cursor position are skipped forever**
   - Example: Client is at page 2 (cursor has id=100, timestamp=T1)
   - Meanwhile, a new record is inserted with id=50, timestamp=T0 (older)
   - Since id=50 < 100, it's "before" the cursor position
   - Client will never see this record despite having not reached the end of the dataset

2. **Records inserted after the cursor position may appear on the next page unexpectedly**
   - Example: Client is at page 2 (cursor has id=100, timestamp=T1)
   - Meanwhile, a new record is inserted with id=150, timestamp=T2 (newer)
   - On the next page request, this record may appear even though it didn't exist when pagination started
   - The client may process this record twice if paginating backward

### Why This Happens

Cursor pagination assumes the underlying dataset is immutable. When records are inserted during pagination:

- We cannot distinguish between records that existed "when pagination started" and records inserted during the process
- The cursor position moves through the dataset, but new records can appear "behind" it

### Impact

This primarily affects clients who:
- Process all records to completion (batch processing, reconciliation, backups)
- Rely on pagination to guarantee they see all records
- Expect a consistent snapshot of data across multiple requests

**Normal browsing (e.g., UI pagination) is typically unaffected** because users scroll forward and don't paginate backward.

---

## Solution: Snapshot-Based Pagination

To guarantee a consistent view of the dataset, clients can use **snapshot-based pagination** with the `snapshotAt` parameter.

### How It Works

1. Client records the current timestamp: `snapshotAt = "2026-03-26T05:00:00Z"`
2. Client adds `snapshotAt` to all pagination requests
3. Server filters: `WHERE timestamp < snapshotAt` (or `<=`, depending on requirements)
4. All pages return records that existed at the specified time, unaffected by concurrent inserts

### Implementation

#### Basic Usage

```bash
# First request: capture the snapshot time and start pagination
GET /donations?limit=20&snapshotAt=2026-03-26T05:00:00Z
Response:
{
  "success": true,
  "data": [ /* records with timestamp < 2026-03-26T05:00:00Z */ ],
  "pagination": {
    "nextCursor": "...",
    "snapshotAt": "2026-03-26T05:00:00Z"
  }
}

# All subsequent requests use the same snapshotAt
GET /donations?limit=20&cursor=...&snapshotAt=2026-03-26T05:00:00Z
```

#### Combined with Cursor Pagination

The `snapshotAt` parameter works together with cursor pagination:

1. **Filter by snapshot**: `WHERE timestamp < :snapshotAt`
2. **Apply cursor filter**: `AND ((timestamp < :cursor_timestamp) OR (timestamp = :cursor_timestamp AND id < :cursor_id))`
3. **Sort by timestamp DESC, id DESC**

#### Processing New Records After Pagination

After completing pagination with a snapshot, to process records inserted after the snapshot:

```bash
# Start a new pagination session with current time
GET /donations?limit=20&snapshotAt=2026-03-26T05:30:00Z
```

This ensures records from `2026-03-26T05:00:00Z` to `2026-03-26T05:30:00Z` are captured and can be processed separately.

### SQL Query Structure

With `snapshotAt` support, queries become:

```sql
SELECT * FROM donations
WHERE timestamp < :snapshotAt              -- Snapshot filter
  AND ((timestamp < :cursor_ts) OR (timestamp = :cursor_ts AND id < :cursor_id))  -- Cursor filter
ORDER BY timestamp DESC, id DESC
LIMIT :limit
```

---

## Implementation Guidelines

### For API Developers

When implementing snapshot support on an endpoint:

1. Accept optional `snapshotAt` query parameter
2. Validate it as a valid ISO-8601 timestamp
3. Add to SQL WHERE clause: `AND timestamp < ?` with the parsed timestamp
4. Include `snapshotAt` in response metadata
5. Document the parameter in API documentation

### For API Clients

**For basic browsing (UI pagination):**
- Use cursor pagination without `snapshotAt`
- Accept that records may be inserted/deleted during scrolling

**For batch processing or reconciliation:**
1. Capture `snapshotAt = Date.now().toISOString()` before starting pagination
2. Include `snapshotAt` in all pagination requests
3. If you need to process records inserted after the snapshot, start a new pagination session with a new `snapshotAt`

**Example Node.js Client:**

```javascript
async function processAllDonations() {
  const snapshotAt = new Date().toISOString();
  let cursor = null;

  while (true) {
    const params = new URLSearchParams({
      limit: 50,
      snapshotAt,
    });
    
    if (cursor) {
      params.append('cursor', cursor);
    }

    const response = await fetch(`/api/v1/donations?${params}`);
    const { data, pagination } = await response.json();

    // Process records
    for (const donation of data) {
      await processRecord(donation);
    }

    // Check for more pages
    if (!pagination.nextCursor) {
      break;
    }

    cursor = pagination.nextCursor;
  }
}
```

---

## Backward Compatibility

The `snapshotAt` parameter is **optional**:
- Without `snapshotAt`: Current behavior (non-deterministic with concurrent inserts)
- With `snapshotAt`: Snapshot-consistent behavior

Existing clients continue to work without changes. New clients requiring consistency can opt in by providing `snapshotAt`.

---

## Database Considerations

### Index Requirements

For efficient snapshot-based pagination, ensure indexes support the filter:

```sql
-- Composite index on (timestamp, id) for sorting and filtering
CREATE INDEX idx_donations_timestamp_id ON donations(timestamp DESC, id DESC);
```

With this index, the query:
```sql
WHERE timestamp < :snapshotAt AND ((timestamp < :cursor_ts) OR ...)
ORDER BY timestamp DESC, id DESC
```

Will use the index efficiently.

### Timestamp Field Requirements

- Must be a valid timestamp column (e.g., `DATETIME`, `TIMESTAMP`)
- Should reflect record creation time or be immutable after creation
- Millisecond precision recommended (for high-throughput scenarios)

---

## Testing Snapshot Pagination

### Scenario: Concurrent Inserts During Pagination

```javascript
// Start pagination session
const page1 = await fetch('/api/v1/donations?limit=10&snapshotAt=T0');

// Simulate concurrent insert
await insertDonation({ amount: 100, createdAt: 'T0.5' });

// Continue pagination with same snapshot
const page2 = await fetch(`/api/v1/donations?limit=10&cursor=${page1.nextCursor}&snapshotAt=T0`);

// page2 should NOT include the newly inserted donation
// (it has timestamp > T0, filtered out by snapshotAt < T0)
assert(!page2.data.some(d => d.id === newDonationId));
```

### Scenario: Processing New Records After Snapshot

```javascript
// Process first snapshot
const snapshot1 = T0;
let allRecords = [];
const page1 = await fetch(`/api/v1/donations?limit=10&snapshotAt=${snapshot1}`);
// ... paginate through all records

// Later, process new records
const snapshot2 = T1 (current time);
const newPage1 = await fetch(`/api/v1/donations?limit=10&snapshotAt=${snapshot2}`);
// ... paginate through newly inserted records
```

---

## Limitations and Trade-Offs

| Scenario | Without `snapshotAt` | With `snapshotAt` |
|----------|---------------------|-------------------|
| Records inserted before cursor during pagination | ❌ Missed (not returned on any page) | ✅ Visible on snapshot pages |
| Records inserted after cursor during pagination | ⚠️ May appear unexpectedly | ✅ Not visible (filtered by snapshotAt) |
| Query performance | Fastest (no snapshot filter) | Slightly slower (additional predicate) |
| Backward compatibility | N/A | ✅ Fully compatible |
| Implementation complexity | Simpler | Moderate (few lines added) |

---

## Related Documentation

- [API Reference](./api-reference.md) – Pagination query parameters
- [API Examples](./API_EXAMPLES.md) – Pagination request/response examples
- [Pagination Source](../src/utils/pagination.js) – Implementation details

---

## FAQ

**Q: Do I need to use `snapshotAt` for all endpoints?**  
A: No, it's optional. Use it only when you need consistent pagination across records (e.g., batch processing).

**Q: What if I don't know the current server time?**  
A: You can use the `createdAt` or `timestamp` from the first response. Or, rely on the client's system time (with the caveat that clock skew could affect results).

**Q: Can I go back and re-paginate with an older `snapshotAt`?**  
A: Yes, as long as records with that timestamp still exist in the database. If you need historical snapshots, ensure data retention policies align with your pagination needs.

**Q: What happens if I mix `snapshotAt` and `direction=prev`?**  
A: Both work together. `snapshotAt` filters records, and `direction` determines pagination direction. Going backward within a snapshot is stable.

