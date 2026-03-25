# Stellar Account Sponsorship

Allows the platform to sponsor new user accounts so they can be created without the user holding any XLM for the base reserve.

## How It Works

Stellar requires every account to maintain a minimum base reserve (currently 1 XLM). With sponsorship, the platform account pays that reserve on behalf of the new user using the `BeginSponsoringFutureReserves` / `EndSponsoringFutureReserves` operation pair.

## Configuration

Set the platform sponsor account's secret key as an environment variable:

```env
SPONSOR_SECRET=S...
```

When `SPONSOR_SECRET` is set, wallets created with `sponsored: true` will use platform sponsorship instead of Friendbot.

## Service Methods

### `StellarService.createSponsoredAccount(sponsorSecret, newAccountPublic)`

Creates a new Stellar account with the sponsor paying the base reserve. Both the sponsor and the new account co-sign the transaction.

| Param | Type | Description |
|---|---|---|
| `sponsorSecret` | string | Sponsor's secret key |
| `newAccountPublic` | string | New account's public key |

Returns `{ transactionId, ledger, sponsored: true }`.

### `StellarService.revokeSponsoredAccount(sponsorSecret, sponsoredPublic)`

Revokes the sponsorship for an account. After revocation the account must maintain its own base reserve.

| Param | Type | Description |
|---|---|---|
| `sponsorSecret` | string | Sponsor's secret key |
| `sponsoredPublic` | string | Sponsored account's public key |

Returns `{ transactionId, ledger, revoked: true }`.

## HTTP Endpoints

### `POST /wallets`

Add `"sponsored": true` to the request body to create a platform-sponsored account.

```json
{
  "address": "G...",
  "label": "Alice",
  "sponsored": true
}
```

Response includes `sponsored: true` when sponsorship was applied:

```json
{
  "success": true,
  "data": {
    "id": "1711234567890",
    "address": "G...",
    "funded": true,
    "sponsored": true
  }
}
```

If `SPONSOR_SECRET` is not set, the request falls back to Friendbot funding (testnet) with `sponsored: false`.

### `POST /wallets/:id/revoke-sponsorship`

Revoke platform sponsorship for a wallet. Requires `SPONSOR_SECRET` to be configured.

**Auth:** `x-api-key` header required (wallets:update permission).

**Response `200`:**
```json
{
  "success": true,
  "data": { "transactionId": "abc123...", "ledger": 1234567, "revoked": true }
}
```

**Error responses:**
- `400` — `SPONSOR_SECRET` not configured
- `404` — Wallet not found or no sponsorship record

## Security Notes

- `SPONSOR_SECRET` is read from the environment and never logged or returned in responses.
- Revocation requires the caller to have `wallets:update` permission.
- The sponsor account must have sufficient XLM to cover the base reserve for each sponsored account.

## Testing

```bash
npm test tests/add-support-for-stellar-account-sponsorship.test.js
```

No live Stellar network required. All tests use `MockStellarService`.
