# Account Sponsorship (Reserve Sponsorship)

Stellar account sponsorship allows one account (the sponsor) to pay the base reserve for another account's entries — trustlines, offers, data entries, and the account itself. This enables onboarding new donors who don't hold enough XLM to cover their own reserve.

## How It Works

1. The platform holds a `SPONSOR_SECRET` key with sufficient XLM.
2. `POST /wallets/:id/sponsor` submits a transaction with `beginSponsoringFutureReserves` + `createAccount` + `endSponsoringFutureReserves` — the new account is created with 0 XLM balance.
3. `GET /wallets/:id/sponsor` queries the Stellar network for the account's current sponsor.
4. `DELETE /wallets/:id/sponsor` calls `revokeSponsorship`. Before revoking, the service checks that the account holds at least `MIN_RESERVE_XLM` (default 1 XLM) to cover its own reserve. Returns 400 if it cannot.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `SPONSOR_SECRET` | — | Secret key of the platform sponsoring account (required) |
| `MIN_RESERVE_XLM` | `1` | Minimum XLM balance required before sponsorship can be revoked |

## API Endpoints

### POST /wallets/:id/sponsor

Sponsor the base reserve for an existing wallet record.

**Auth**: `wallets:update` permission required

**Response**:
```json
{ "success": true, "data": { "transactionId": "abc...", "ledger": 123456, "sponsored": true } }
```

**Errors**: `400` if `SPONSOR_SECRET` not configured; `404` if wallet not found.

### DELETE /wallets/:id/sponsor

Revoke sponsorship. The account must hold at least `MIN_RESERVE_XLM` XLM.

**Auth**: `wallets:update` permission required

**Query params**: `entryType` (optional, default `account`) — the entry type to revoke.

**Response**:
```json
{ "success": true, "data": { "transactionId": "def...", "ledger": 123457, "revoked": true } }
```

**Errors**: `400` if balance is below minimum reserve or `SPONSOR_SECRET` not configured; `404` if wallet not found.

### GET /wallets/:id/sponsor

Return the current sponsorship status.

**Auth**: `wallets:read` permission required

**Response**:
```json
{ "success": true, "data": { "sponsored": true, "sponsoredBy": "GABC..." } }
```

**Errors**: `404` if wallet not found.

## Service Methods

| Method | Description |
|---|---|
| `StellarService.sponsorAccount(sponsorSecret, newAccountPublicKey)` | Submit `beginSponsoringFutureReserves` + `createAccount` + `endSponsoringFutureReserves` |
| `StellarService.revokeSponsorship(sponsorSecret, targetPublicKey, entryType)` | Submit `revokeSponsorship` operation |
| `StellarService.getSponsorshipStatus(publicKey)` | Load account from Horizon and return `sponsor` field |
| `WalletService.sponsorAccount(id)` | Validate config, call service, update wallet record |
| `WalletService.revokeSponsorship(id, entryType)` | Check reserve, call service, update wallet record |
| `WalletService.getSponsorshipStatus(id)` | Delegate to stellar service |

## MockStellarService

`MockStellarService` simulates the full sponsorship lifecycle:

- `sponsorAccount` — alias for `createSponsoredAccount`; records in `this.sponsorships` map
- `revokeSponsorship` — alias for `revokeSponsoredAccount`; sets `revokedAt` on the record
- `getSponsorshipStatus` — reads from `this.sponsorships` map; returns `{ sponsored, sponsoredBy }`

## Security Notes

- `SPONSOR_SECRET` must never be committed to source control. Use environment injection or a secrets manager.
- The reserve check before revocation prevents leaving an account in an unfunded state that Stellar would reject.
