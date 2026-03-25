# Memo Collision Detection

## Overview

Multiple users may accidentally or maliciously reuse the same memo (e.g. a student ID), causing payments to be attributed to the wrong person. This feature detects duplicate memo usage within a rolling time window, applies secondary validation, and flags suspicious transactions.

---

## Detection Strategy

1. Every payment memo is tracked in a rolling in-memory window (default: 5 minutes).
2. When the same memo appears more than once within the window, a **collision** is recorded.
3. Secondary validation is applied to determine whether the collision is **suspicious**:

| Condition | Reason Code | Risk |
|---|---|---|
| Different donor uses the same memo | `DIFFERENT_DONOR_SAME_MEMO` | High — misattribution likely |
| Same donor, different amount | `AMOUNT_MISMATCH` | Medium — possible tampering |
| Same donor, mismatched session ID | `SESSION_ID_MISMATCH` | Medium — session hijack risk |
| Same donor, same amount, same session | _(none)_ | Low — likely a retry |

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEMO_COLLISION_WINDOW_MS` | `300000` (5 min) | Rolling window for collision detection |

---

## New Fields on Transaction Records

| Field | Type | Description |
|---|---|---|
| `memoCollision` | boolean | `true` when memo was seen before in the window |
| `memoSuspicious` | boolean | `true` when secondary validation failed |
| `memoCollisionReason` | string \| null | Reason code for the suspicious flag |

---

## Optional Request Field

Pass `sessionId` in `createDonationRecord` to enable session-based secondary validation:

```js
donationService.createDonationRecord({
  amount: 100,
  donor: 'GDONOR...',
  recipient: 'GRECIP...',
  memo: 'STU-12345',
  sessionId: 'sess-abc123',   // optional
});
```

---

## API

```
GET /stats/memo-collisions
GET /stats/memo-collisions?startDate=2026-01-01&endDate=2026-03-31
```

Response:

```json
{
  "success": true,
  "data": {
    "totalCollisions": 2,
    "totalSuspicious": 1,
    "transactions": [
      {
        "id": "...",
        "memo": "STU-12345",
        "donor": "GDONOR...",
        "recipient": "GRECIP...",
        "amount": 100,
        "memoSuspicious": true,
        "memoCollisionReason": "DIFFERENT_DONOR_SAME_MEMO",
        "timestamp": "2026-03-23T10:00:00.000Z"
      }
    ]
  },
  "metadata": {
    "note": "Collisions occur when the same memo is used more than once within the detection window"
  }
}
```

---

## Implementation

- Detector: `src/utils/memoCollisionDetector.js`
- Integration: `src/services/DonationService.js` → `createDonationRecord()`
- Stats: `src/services/StatsService.js` → `getMemoCollisionStats()`
- Endpoint: `src/routes/stats.js` → `GET /stats/memo-collisions`
- Tests: `tests/memo-collision-detection.test.js`

---

## Security Notes

- Detection is **observability-only** — collisions are logged and flagged but payments are not blocked (consistent with the existing suspicious pattern detection approach).
- The in-memory store is scoped to the running process. For multi-instance deployments, consider a shared store (Redis).
- Memos are normalised (trimmed) before comparison to prevent trivial bypass via whitespace.
