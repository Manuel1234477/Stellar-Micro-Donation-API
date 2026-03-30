# Stellar Bump Sequence Operation

## Overview

The bump sequence operation sets a Stellar account's sequence number to a specific value that is higher than the current one. This is a security primitive for invalidating pre-signed transactions — useful in time-locked escrow arrangements, multi-party payment channels, and any scenario where you need to cancel outstanding signed-but-unsubmitted transactions.

## Security Model

- Requires `ADMIN_ALL` (`*`) permission — only admin API keys can call this endpoint.
- Every invocation is written to the immutable audit trail with `HIGH` severity.
- The `secret` key is never logged; only the wallet ID, target sequence, and resulting transaction hash are recorded.
- Sequence numbers are monotonically increasing on Stellar: you can only bump *up*, never down. This is enforced both by the Stellar network and by `MockStellarService`.

## API

### `POST /wallets/:id/bump-sequence`

Bump the sequence number of the Stellar account associated with wallet `:id`.

**Authentication:** Admin API key required (`ADMIN_ALL` permission).

**Request body:**

| Field    | Type   | Required | Description                                      |
|----------|--------|----------|--------------------------------------------------|
| `secret` | string | yes      | Stellar secret key (S…) of the account to bump  |
| `bumpTo` | string | yes      | Target sequence number (must be > current value) |

**Example request:**

```bash
curl -X POST https://api.example.com/wallets/42/bump-sequence \
  -H "Authorization: Bearer <admin-api-key>" \
  -H "Content-Type: application/json" \
  -d '{"secret": "S...", "bumpTo": "9999999"}'
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "hash": "abc123...",
    "ledger": 1234567,
    "newSequence": "9999999"
  }
}
```

**Error responses:**

| Status | Condition                                      |
|--------|------------------------------------------------|
| 400    | Missing or invalid `secret` / `bumpTo` fields  |
| 401    | No API key provided                            |
| 403    | API key lacks admin permission                 |
| 404    | Wallet ID not found in the system              |
| 422    | `bumpTo` ≤ current sequence (Stellar rejects)  |

## Implementation

### `StellarService.bumpSequence(secret, bumpTo)`

Builds and submits a `BumpSequence` operation to the Stellar network.

```js
/**
 * Bump an account's sequence number to a specific value.
 * @param {string} secret  - Stellar secret key of the account
 * @param {string|number} bumpTo - Target sequence number (must be > current)
 * @returns {Promise<{hash: string, ledger: number, newSequence: string}>}
 */
async bumpSequence(secret, bumpTo)
```

### `MockStellarService.bumpSequence(secret, bumpTo)`

Simulates the operation in-memory for tests. Updates the wallet's `sequence` field and returns a deterministic mock result. Throws if `bumpTo ≤ current sequence` or if the secret key is unknown.

## Audit Trail

On every call the route logs to `audit_logs`:

| Field      | Value                        |
|------------|------------------------------|
| `category` | `WALLET_OPERATION`           |
| `action`   | `BUMP_SEQUENCE_EXECUTED` / `BUMP_SEQUENCE_FAILED` |
| `severity` | `HIGH`                       |
| `details`  | `{ walletId, walletAddress, bumpTo, hash }` |

## Use Cases

- **Invalidate escrow**: After a time-locked escrow expires, bump the sequence to make any pre-signed release transactions invalid before returning funds.
- **Cancel pending multi-sig**: If a co-signer goes offline, bump the sequence to void outstanding partially-signed transactions.
- **Key rotation safety**: After rotating signing keys, bump the sequence to ensure old signed transactions cannot be replayed.

## Security Assumptions

1. **Monotonicity**: Stellar enforces that sequence numbers only increase. A bump cannot be reversed.
2. **Pre-signed tx invalidation**: Any transaction signed with a sequence number ≤ `bumpTo` will be rejected by the network after the bump.
3. **Secret key handling**: The `secret` field is transmitted over TLS and is never persisted or logged by this API.
4. **Admin-only**: Bumping a sequence is a destructive, irreversible operation. Non-admin callers receive a `403`.
