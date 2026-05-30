# Donation Receipt PDF

Donors can request an official PDF receipt for any **confirmed** donation. The receipt includes all relevant transaction details and a QR code linking to the Stellar explorer. Receipts can optionally be emailed to a provided address.

## Endpoints

### `POST /donations/:id/receipt`

Generate and download a PDF receipt for a confirmed donation.

**Request body** (optional):
```json
{ "email": "donor@example.com" }
```

- `email` — if provided, the PDF is also sent as an email attachment via SMTP.

**Response**: `application/pdf` binary stream with headers:
- `Content-Disposition: attachment; filename="receipt-<id>.pdf"`
- `X-Email-Message-Id: <messageId>` (only when email was sent)

**Error responses**:
| Status | Reason |
|--------|--------|
| 400 | Donation is not in `confirmed` state |
| 400 | `email` field is present but invalid |
| 404 | Donation ID not found |

---

### `GET /donations/:id/receipt/status`

Check whether a receipt has been generated for a donation.

**Response**:
```json
{
  "success": true,
  "data": {
    "donationId": "abc-123",
    "generated": true,
    "generatedAt": "2026-03-29T18:00:00.000Z",
    "emailedTo": "donor@example.com"
  }
}
```

`emailedTo` is `null` when no email was requested.

---

## PDF Contents

Each receipt includes:

| Field | Description |
|-------|-------------|
| Receipt ID | Internal donation ID |
| Date | UTC timestamp of the donation |
| Status | Transaction status |
| Amount | Amount in XLM |
| Donor | Donor public key or "Anonymous" |
| Recipient | Recipient public key |
| Memo | Transaction memo (if any) |
| Stellar Transaction Hash | On-chain hash |
| Explorer URL | Link to Stellar explorer |
| QR Code | Scannable link to the Stellar explorer (when hash is available) |

---

## Email Delivery (SMTP)

Configure SMTP via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | `localhost` | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `SMTP_SECURE` | `false` | Use TLS (`true`/`false`) |
| `SMTP_FROM` | `receipts@stellar-donations.local` | Sender address |
| `STELLAR_EXPLORER_URL` | `https://stellar.expert/explorer/testnet/tx` | Base URL for QR code |

---

## Audit Logging

Every receipt generation is recorded in the audit log with:
- `category`: `FINANCIAL_OPERATION`
- `action`: `RECEIPT_GENERATED`
- `severity`: `LOW`
- `details`: `{ donationId, emailed, emailedTo, messageId }`

---

## Authentication

Both endpoints require a valid API key with `donations:read` permission.
