# Soroban Contract Invocation

Enables invoking, simulating, and reading state from Soroban smart contracts via the API. Supports use cases like conditional donation release, on-chain matching programs, and escrow.

All invocations are logged for auditability. All write endpoints require the **admin** role.

## Endpoints

### Invoke a contract method

```
POST /contracts/:contractId/invoke
```

Invokes a Soroban contract method on-chain. The invocation is logged with contract ID, method, and argument count.

**Body:**
```json
{
  "method": "deposit",
  "args": ["donor-address", 100],
  "sourceSecret": "S..."
}
```

| Field          | Type   | Required | Description                          |
|----------------|--------|----------|--------------------------------------|
| `method`       | string | yes      | Contract function name               |
| `args`         | array  | yes      | Arguments (see supported types below)|
| `sourceSecret` | string | no       | Invoking account secret key          |

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "success",
    "returnValue": { "donorId": "donor-address", "amount": 100, "newBalance": 100 },
    "transactionHash": "abc123...",
    "ledger": 1234567,
    "events": [
      {
        "contractId": "C001",
        "type": "deposit",
        "topics": ["deposit", "donor-address"],
        "data": { "donorId": "donor-address", "amount": 100 },
        "timestamp": "2026-03-30T10:00:00.000Z",
        "ledger": 1234567
      }
    ]
  }
}
```

When the contract returns an error (e.g. goal not reached), `status` is `"error"` and `returnValue` contains the error message. HTTP status is still 200.

---

### Simulate a contract invocation (dry-run)

```
POST /contracts/:contractId/simulate
```

Runs the contract method locally without submitting to the network. No state is modified, no events are emitted.

**Body:** same as `/invoke` (without `sourceSecret`)

**Response:**
```json
{
  "success": true,
  "data": {
    "status": "success",
    "returnValue": null,
    "cost": { "cpuInsns": "1000", "memBytes": "512" },
    "footprint": { "readOnly": [], "readWrite": ["contract:C001"] }
  }
}
```

---

### Read contract state

```
GET /contracts/:contractId/state
```

Returns the current data entries of a contract as key/value pairs.

**Response:**
```json
{
  "success": true,
  "count": 4,
  "data": [
    { "key": "balance", "value": 250 },
    { "key": "goalAmount", "value": 500 },
    { "key": "donors", "value": { "donor-address": 250 } },
    { "key": "released", "value": false }
  ]
}
```

---

### Get contract events

```
GET /contracts/:contractId/events?limit=20
```

Returns stored contract events in reverse-chronological order. Does not require admin role.

**Query params:**

| Parameter | Type    | Description                        |
|-----------|---------|------------------------------------|
| `limit`   | integer | Max events to return (positive int)|

**Response:**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "contractId": "C001",
      "type": "deposit",
      "topics": ["deposit", "donor-address"],
      "data": { "donorId": "donor-address", "amount": 100 },
      "timestamp": "2026-03-30T10:00:00.000Z",
      "ledger": 1234568
    }
  ]
}
```

## Supported Argument Types

| Type      | Example                                      |
|-----------|----------------------------------------------|
| `i128`    | `100` (JavaScript number)                    |
| `address` | `"GABC..."` (Stellar public key string)      |
| `bool`    | `true` / `false`                             |
| `bytes`   | `"68656c6c6f"` (hex-encoded string)          |
| `string`  | `"donor-1"` (arbitrary string identifier)    |

Arguments are passed as a plain JSON array. The contract implementation is responsible for interpreting types.

## Security

- `POST /contracts/:contractId/invoke` — admin only
- `POST /contracts/:contractId/simulate` — admin only
- `GET /contracts/:contractId/state` — admin only
- `GET /contracts/:contractId/events` — public (read-only)

Non-admin requests to write endpoints receive `403 Forbidden`.

Every invocation is written to the audit log with:
- `contractId` and `method`
- `argCount` (argument count — values are not logged to avoid leaking sensitive data)
- `result` (`SUCCESS` or `FAILURE`)
- `userId`, `requestId`, `ipAddress`

## Mock Mode

In development (`MOCK_STELLAR=true`), `MockStellarService` simulates contract behaviour using `EscrowContract`:

- `deposit(donorId, amount)` — adds to escrow balance
- `release(recipientId, goal)` — releases funds if balance ≥ goal
- All other methods — return `status: "success"` with no events

Simulation (`/simulate`) never modifies mock state.
