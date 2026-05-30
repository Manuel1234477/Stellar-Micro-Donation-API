# Corporate Matching Extended

Extends the donation platform with employer-verified corporate gift matching: an allowlist of approved employers, configurable match ratios and annual caps, and a full claim workflow with admin review and on-chain execution.

---

## Architecture

```
CorporateMatchingService          corporateMatching.js (routes)
├── employers: Map                ├── POST /admin/corporate-matching/employers
├── claims: Map                   ├── GET  /admin/corporate-matching/employers
├── addEmployer()                 ├── POST /corporate-matching/claim
├── submitClaim()                 ├── GET  /admin/corporate-matching/claims
├── approveClaim()  ──────────────├── POST /admin/corporate-matching/claims/:id/approve
└── rejectClaim()                 └── POST /admin/corporate-matching/claims/:id/reject
```

---

## Endpoints

### Admin — Employer Allowlist

#### `POST /admin/corporate-matching/employers`

Add or update an employer in the allowlist.

**Request body:**
```json
{
  "employerId": "acme-corp",
  "name": "Acme Corporation",
  "matchRatio": 2,
  "annualCap": 5000
}
```

| Field | Type | Description |
|---|---|---|
| `employerId` | string | Unique employer identifier |
| `name` | string | Display name |
| `matchRatio` | 1 \| 2 \| 3 | Multiplier applied to the donor's donation |
| `annualCap` | number | Max XLM matched per donor per calendar year |

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "employerId": "acme-corp",
    "name": "Acme Corporation",
    "matchRatio": 2,
    "annualCap": 5000,
    "addedAt": "2026-03-30T00:00:00.000Z"
  }
}
```

---

#### `GET /admin/corporate-matching/employers`

List all employers in the allowlist.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    { "employerId": "acme-corp", "name": "Acme Corporation", "matchRatio": 2, "annualCap": 5000, "addedAt": "..." }
  ]
}
```

---

### Donor — Submit Claim

#### `POST /corporate-matching/claim`

Donor submits a match request referencing their employer. The employer must be in the allowlist. The match amount is computed as `donationAmount × matchRatio`, capped by the remaining annual cap.

**Request body:**
```json
{
  "donorId": "donor-abc",
  "employerId": "acme-corp",
  "donationAmount": 100
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "donorId": "donor-abc",
    "employerId": "acme-corp",
    "donationAmount": 100,
    "matchAmount": 200,
    "status": "pending",
    "createdAt": "2026-03-30T00:00:00.000Z"
  }
}
```

**Error cases:**
- `400` — employer not in allowlist, missing fields, non-positive amount, annual cap exhausted

---

### Admin — Claims Management

#### `GET /admin/corporate-matching/claims`

List claims. Optionally filter by `?status=pending|approved|rejected`.

---

#### `POST /admin/corporate-matching/claims/:id/approve`

Approve a pending claim. Triggers the matching donation on-chain via `stellarService.sendPayment()`.

**Request body:**
```json
{
  "sourcePublicKey": "GEMPLOYER...",
  "donorPublicKey": "GDONOR..."
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "approved",
    "txId": "mock_abc123...",
    "reviewedAt": "2026-03-30T00:00:00.000Z"
  }
}
```

> If the annual cap has been exceeded between claim submission and approval, the claim is automatically set to `rejected` with `rejectReason: "Annual cap exceeded at approval time"`.

---

#### `POST /admin/corporate-matching/claims/:id/reject`

Reject a pending claim.

**Request body:**
```json
{ "reason": "Employment not verified" }
```

---

## Annual Cap Enforcement

The cap is enforced at two points:

1. **Claim submission** — if `alreadyMatchedThisYear + matchAmount > annualCap`, the claim is rejected immediately.
2. **Claim approval** — re-checked to guard against concurrent approvals; auto-rejects if cap is now exceeded.

Only `approved` claims in the current calendar year count toward the cap.

---

## Match Ratios

| `matchRatio` | Donor donates | Employer matches |
|---|---|---|
| 1 | 100 XLM | 100 XLM |
| 2 | 100 XLM | 200 XLM |
| 3 | 100 XLM | 300 XLM |

---

## On-Chain Execution

On approval, `CorporateMatchingService.approveClaim()` calls:

```js
stellarService.sendPayment(sourcePublicKey, donorPublicKey, matchAmount, memo)
```

The returned `hash` / `transactionId` is stored as `claim.txId`. In production, replace `MockStellarService` with the real `StellarService`.

---

## Service API (JSDoc summary)

```js
// Employer management
addEmployer(employerId, name, matchRatio, annualCap) → employer
listEmployers() → employer[]
isEmployerAllowed(employerId) → boolean

// Cap tracking
getYearlyMatchedAmount(donorId, employerId) → number

// Claim workflow
submitClaim(donorId, employerId, donationAmount) → claim
listClaims(status?) → claim[]
approveClaim(claimId, sourcePublicKey, donorPublicKey) → Promise<claim>
rejectClaim(claimId, reason?) → claim
```

---

## Tests

```
tests/corporate-matching-extended.test.js
```

Covers:
- Employer allowlist CRUD and validation
- Claim submission with ratio calculation and cap capping
- Annual cap exhaustion rejection
- Admin approval with on-chain execution and txId
- Double-approval prevention
- Cap enforcement at approval time (race condition guard)
- Admin rejection with and without reason
- Double-rejection prevention
- Past-year claims excluded from cap calculation
- `listClaims` status filtering
