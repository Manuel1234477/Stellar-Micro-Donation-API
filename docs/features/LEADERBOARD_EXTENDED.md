# Real-Time Donation Leaderboard with Configurable Time Windows

Extends the existing leaderboard with daily, weekly, and all-time windows, SSE-based real-time rank-change streaming, a snapshot endpoint for initial page load, and donor opt-out anonymization.

## Time Windows

| Window | Description |
|---|---|
| `daily` | Donations since midnight today |
| `weekly` | Donations in the last 7 days |
| `all-time` | All confirmed donations |

## Anonymization

Donors and recipients who opt out via `PATCH /wallets/:id/leaderboard-visibility` appear as **"Anonymous Donor"** in all leaderboard responses. The opt-out is stored as `leaderboard_visibility: false` on the wallet record.

## API Endpoints

### GET /leaderboard/snapshot

Returns current rankings for a given window. Suitable for initial page load.

**Auth**: `stats:read` permission

**Query params**:
- `window`: `daily` | `weekly` | `all-time` (default: `all-time`)
- `limit`: 1–100 (default: 10)

**Response**:
```json
{
  "success": true,
  "data": {
    "window": "weekly",
    "donors": [{ "rank": 1, "donor": "GABC...", "totalDonated": 50, "donationCount": 3 }],
    "recipients": [{ "rank": 1, "recipient": "GXYZ...", "totalReceived": 50 }],
    "generatedAt": "2026-03-29T10:00:00.000Z"
  }
}
```

**Errors**: `400` for invalid window.

### GET /leaderboard/stream

SSE endpoint. Sends an initial snapshot on connect, then pushes `leaderboard.update` events whenever a donation is confirmed.

**Auth**: `stats:read` permission

**Query params**:
- `window`: `daily` | `weekly` | `all-time` (default: `all-time`)

**Event format**:
```
data: {"type":"rank_change","window":"daily","donors":[...],"recipients":[...],"timestamp":"..."}
```

**Errors**: `400` for invalid window.

### PATCH /wallets/:id/leaderboard-visibility

Opt a wallet in or out of public leaderboard ranking.

**Auth**: `wallets:update` permission

**Body**: `{ "visible": false }`

**Response**: `{ "success": true, "data": { "id": 1, "leaderboard_visibility": false } }`

**Errors**: `400` if `visible` is not a boolean; `404` if wallet not found.

## Service API (`LeaderboardSSE`)

| Export | Description |
|---|---|
| `computeLeaderboard(window, limit)` | Compute donors + recipients for a window, with anonymization |
| `getSnapshot(window, limit)` | Same as above plus `generatedAt` timestamp |
| `broadcastAll()` | Broadcast rank-change events for all windows to SSE clients |
| `WINDOWS` | `['daily', 'weekly', 'all-time']` |
| `ANON_NAME` | `'Anonymous Donor'` |

## How Anonymization Works

1. `computeLeaderboard` calls `Wallet.getAll()` and builds a `Set` of addresses where `leaderboard_visibility === false`.
2. Each leaderboard entry is passed through `anonymize()` — if the donor/recipient address is in the opted-out set, the address field is replaced with `"Anonymous Donor"`.
3. This applies to both `getSnapshot` and SSE broadcasts.
