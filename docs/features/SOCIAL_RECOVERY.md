# Social Recovery

Guardian-based account recovery using Stellar multi-sig. If a user loses their private key, a threshold of pre-designated guardians can collectively authorize transferring funds to a new account.

## How It Works

1. **Designate guardians** — wallet owner sets trusted guardian public keys and a threshold.
2. **Initiate recovery** — anyone can open a recovery request specifying the new destination key. A **48-hour time-lock** starts immediately.
3. **Guardians approve** — each guardian calls the approve endpoint. Approvals accumulate.
4. **Auto-execute** — once the threshold is met *and* the 48-hour time-lock has elapsed, funds are transferred to the new account via `AccountMerge`.

```
Owner sets guardians (A, B, C) with threshold=2
         │
         ▼
Recovery initiated → executeAfter = now + 48h
         │
         ▼
Guardian A approves (1/2)
Guardian B approves (2/2) ──► threshold met
         │
         ├─ time-lock not passed → status: pending
         └─ time-lock passed     → execute → funds → newPublicKey
```

## Security Assumptions

- **Guardian threshold**: majority (ceil(n/2)) by default. Configurable at guardian-set time.
- **Time-lock bypass prevention**: `executeAfter` is set server-side at initiation and cannot be modified by clients. Recovery only executes when `now >= executeAfter`.
- **Duplicate approvals**: the `UNIQUE(recoveryRequestId, guardianPublicKey)` constraint prevents a guardian from approving twice.
- **Guardian replacement**: setting new guardians cancels no in-flight requests — initiate a new recovery to use updated guardians.
- **Unauthorized guardians**: only keys in `recovery_guardians` for the wallet are accepted.

## API Endpoints

### Set Guardians
```
POST /wallets/:id/recovery/guardians
Authorization: X-API-Key <key>

{
  "guardianPublicKeys": ["GABC...", "GDEF...", "GHIJ..."],
  "threshold": 2
}
```

### Get Guardians
```
GET /wallets/:id/recovery/guardians
```

### Initiate Recovery
```
POST /wallets/:id/recovery/initiate

{
  "newPublicKey": "GNEW..."
}

Response 201:
{
  "success": true,
  "data": {
    "id": 1,
    "walletId": 42,
    "newPublicKey": "GNEW...",
    "status": "pending",
    "threshold": 2,
    "executeAfter": "2026-03-29T17:07:25.000Z"
  }
}
```

### Approve Recovery
```
POST /wallets/:id/recovery/approve

{
  "recoveryRequestId": 1,
  "guardianPublicKey": "GABC..."
}

Response 200:
{
  "success": true,
  "data": {
    "id": 1,
    "status": "pending",   // or "executed" if threshold met + time-lock passed
    "approvalCount": 1,
    "threshold": 2
  }
}
```

### Get Recovery Request Status
```
GET /wallets/:id/recovery/:requestId
```

## Database Schema

```sql
-- Guardian registry per wallet
CREATE TABLE recovery_guardians (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  walletId INTEGER NOT NULL,
  guardianPublicKey TEXT NOT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (walletId, guardianPublicKey)
);

-- Recovery requests with time-lock
CREATE TABLE recovery_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  walletId INTEGER NOT NULL,
  newPublicKey TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | executed | cancelled
  threshold INTEGER NOT NULL,
  executeAfter DATETIME NOT NULL,          -- now + 48h, set server-side
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  executedAt DATETIME
);

-- Per-guardian approvals (UNIQUE prevents duplicates)
CREATE TABLE recovery_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recoveryRequestId INTEGER NOT NULL,
  guardianPublicKey TEXT NOT NULL,
  approvedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (recoveryRequestId, guardianPublicKey)
);
```

## Permissions

| Action | Required Permission |
|--------|-------------------|
| Set/initiate/approve | `wallets:write` |
| Read guardians/status | `wallets:read` |
