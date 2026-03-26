# Anonymous Donations with Privacy Preservation

## Overview

Some donors want to remain anonymous while still having their donations recorded for tax
purposes. This feature allows a donor to set `anonymous: true` when creating a donation.
The system then stores a **pseudonymous identifier** derived from the donor's wallet address
using HMAC-SHA256, instead of the real wallet address.

The donor can later **prove** their anonymous donation to a trusted third party (e.g. a tax
authority) by sharing their wallet address privately. The verifier calls
`GET /donations/verify-anonymous` to confirm the match without the wallet address ever
appearing in public records.

---

## Security Model

| Property | Detail |
|---|---|
| Algorithm | HMAC-SHA256 |
| Key | `ANONYMOUS_DONATION_SECRET` environment variable (≥ 32 random bytes recommended) |
| Output | `anon_<64-hex-chars>` — 69 characters total |
| One-way | Wallet address cannot be recovered from the pseudonymous ID without the secret |
| Consistent | Same wallet address always produces the same pseudonymous ID (deterministic) |
| Timing-safe | Verification uses `crypto.timingSafeEqual` to prevent timing attacks |

### Environment Variable

```
ANONYMOUS_DONATION_SECRET=<strong-random-secret-at-least-32-bytes>
```

Generate a suitable secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## API Changes

### POST /donations

Add `anonymous: true` to the request body to create an anonymous donation.

**Request body (new field):**

```json
{
  "amount": "10",
  "recipient": "GABC...",
  "donor": "GXYZ...",
  "anonymous": true
}
```

**Behaviour:**
- The `donor` field in the stored record is replaced with `anon_<hmac-sha256-hex>`.
- The `anonymous: true` flag is stored on the transaction.
- The `pseudonymousId` field holds the derived identifier.
- The real wallet address is **never persisted**.

**Response (unchanged):**

```json
{
  "success": true,
  "data": {
    "verified": true,
    "transactionHash": "..."
  }
}
```

---

### GET /donations/verify-anonymous

Allows a donor to prove their anonymous donation.

**Query parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `donationId` | string | yes | The ID of the anonymous donation |
| `walletAddress` | string | yes | The donor's wallet address to verify |

**Example request:**

```
GET /donations/verify-anonymous?donationId=1234567890-abc&walletAddress=GXYZ...
```

**Success response (200):**

```json
{
  "success": true,
  "data": {
    "verified": true,
    "donationId": "1234567890-abc",
    "pseudonymousId": "anon_a3f2...",
    "amount": 10,
    "recipient": "GABC...",
    "timestamp": "2026-03-25T12:00:00.000Z"
  }
}
```

**Verification failed (200, verified=false):**

```json
{
  "success": true,
  "data": {
    "verified": false,
    "donationId": "1234567890-abc",
    "pseudonymousId": "anon_a3f2...",
    "amount": 10,
    "recipient": "GABC...",
    "timestamp": "2026-03-25T12:00:00.000Z"
  }
}
```

**Error responses:**

| Status | Code | Reason |
|---|---|---|
| 400 | `MISSING_REQUIRED_FIELDS` | `donationId` or `walletAddress` missing |
| 400 | `INVALID_REQUEST` | Donation is not anonymous |
| 404 | `DONATION_NOT_FOUND` | Donation ID does not exist |

---

## Leaderboard Exclusion

Anonymous donations are **excluded** from all public donor rankings:

- `GET /stats` donor stats (`getDonorStats`)
- Dashboard `topDonors` list (`getDashboardData`)
- `DonationService.getLeaderboard()`
- `DonationService.getRecentDonations({ excludeAnonymous: true })`

This ensures that pseudonymous IDs (`anon_...`) never appear in public leaderboards,
preserving the privacy intent of the feature.

---

## Implementation Details

### Files Changed / Added

| File | Change |
|---|---|
| `src/utils/anonymization.js` | **New** — HMAC-SHA256 utility (`generatePseudonymousId`, `verifyPseudonymousId`, `isPseudonymousId`) |
| `src/services/DonationService.js` | `createDonationRecord` handles `anonymous` flag; new `verifyAnonymousDonation` and `getLeaderboard` methods; updated `getRecentDonations` |
| `src/routes/donation.js` | Schema accepts `anonymous` boolean; new `GET /donations/verify-anonymous` endpoint |
| `src/services/StatsService.js` | `getDonorStats` and `getDashboardData` exclude anonymous donations |
| `tests/add-support-for-anonymous-donations-with-privacy-p.test.js` | **New** — full test suite |

### Transaction Record Fields (new)

| Field | Type | Description |
|---|---|---|
| `anonymous` | boolean | `true` when the donation was made anonymously |
| `pseudonymousId` | string \| null | `anon_<sha256-hex>` when `anonymous=true`, otherwise `null` |

---

## Testing

```bash
npm test tests/add-support-for-anonymous-donations-with-privacy-p.test.js
```

The test suite covers:
- Pseudonymous ID generation and consistency
- Timing-safe verification (correct and incorrect wallet addresses)
- Anonymous donation creation via `DonationService`
- Leaderboard exclusion
- `GET /donations/verify-anonymous` endpoint (success, failure, missing params, non-anonymous donation)
- Edge cases: missing wallet address, empty string, whitespace

---

## Security Assumptions

1. `ANONYMOUS_DONATION_SECRET` must be kept confidential. Exposure of the secret allows
   anyone to derive pseudonymous IDs from wallet addresses.
2. The secret should be rotated if compromised. Rotation will change all future pseudonymous
   IDs but will not affect existing records.
3. The feature does not prevent a donor from voluntarily disclosing their wallet address.
4. The pseudonymous ID is not a commitment scheme — it does not hide the *amount* or
   *recipient* of the donation.
