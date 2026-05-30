# Validation Error Messages

Structured, per-field validation errors across all API endpoints.

---

## Error Object Shape

Every validation error response has this envelope:

```json
{
  "success": false,
  "errors": [
    {
      "code": "MISSING_AMOUNT",
      "field": "amount",
      "receivedValue": null,
      "expectedFormat": "Positive number (e.g. 10.5)",
      "docLink": "/docs/validation-errors#missing_amount"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `code` | string | Machine-readable error code |
| `field` | string | Request field that failed validation |
| `receivedValue` | any | Value that was received (masked if sensitive) |
| `expectedFormat` | string | Human-readable description of the expected value |
| `docLink` | string | Link to this reference anchored at the specific code |

---

## Sensitive Field Masking

Values for sensitive fields are always masked: the first two characters are preserved and the rest replaced with `***`.

Example — a secret key `SABCDEF123` becomes `SA***`.

Sensitive fields: `secretKey`, `secret`, `password`, `privateKey`, `serviceSecretKey`, `sourceSecret`, `key`, `token`, `apiKey`.

---

## Error Code Reference

The live reference is available at runtime:

```
GET /docs/validation-errors
```

### Donation Errors

| Code | Field | Expected Format |
|---|---|---|
| `MISSING_AMOUNT` | `amount` | Positive number (e.g. 10.5) |
| `INVALID_AMOUNT_TYPE` | `amount` | Positive number (e.g. 10.5) |
| `AMOUNT_TOO_LOW` | `amount` | Positive number greater than 0 |
| `AMOUNT_BELOW_MINIMUM` | `amount` | Number >= configured minimum XLM |
| `AMOUNT_EXCEEDS_MAXIMUM` | `amount` | Number <= configured maximum XLM |
| `DAILY_LIMIT_EXCEEDED` | `amount` | Number within remaining daily allowance |
| `MISSING_RECIPIENT` | `recipient` | Non-empty string (Stellar public key or identifier) |
| `SAME_SENDER_RECIPIENT` | `recipient` | Different value from donor |
| `MISSING_IDEMPOTENCY_KEY` | `idempotency-key` | Non-empty string header (UUID recommended) |
| `MISSING_TRANSACTION_HASH` | `transactionHash` | Non-empty hex string |
| `MISSING_STATUS` | `status` | One of: pending, confirmed, failed, cancelled |
| `INVALID_STATUS` | `status` | One of: pending, confirmed, failed, cancelled |

### Wallet Errors

| Code | Field | Expected Format |
|---|---|---|
| `MISSING_ADDRESS` | `address` | Stellar public key (starts with G, 56 chars) |
| `MISSING_WALLET_FIELD` | `label\|ownerName` | At least one non-empty string |

### Transaction / Pagination Errors

| Code | Field | Expected Format |
|---|---|---|
| `MISSING_PUBLIC_KEY` | `publicKey` | Stellar public key (starts with G, 56 chars) |
| `INVALID_LIMIT` | `limit` | Positive integer |
| `INVALID_OFFSET` | `offset` | Non-negative integer |

---

## Utility API

```js
const { formatError, buildErrorResponse, maskValue, isSensitive } =
  require('./src/utils/validationErrorFormatter');

// Single error
formatError('MISSING_AMOUNT', receivedValue);
// → { code, field, receivedValue, expectedFormat, docLink }

// Multiple errors (for a 400 response body)
buildErrorResponse([
  { code: 'MISSING_AMOUNT', receivedValue: null },
  { code: 'MISSING_RECIPIENT', receivedValue: undefined },
]);
// → { success: false, errors: [...] }

// Masking helpers
maskValue('SABCDEF');   // → 'SA***'
isSensitive('secret'); // → true
```

---

## Tests

```bash
npx jest tests/validation-error-messages-extended.test.js --coverage
```

Coverage: **100% statements, branches, functions, lines** on new files.

Test cases cover: `maskValue` edge cases, `isSensitive` for all sensitive/non-sensitive fields, `formatError` structure and masking, `buildErrorResponse` bulk formatting, `ERROR_REGISTRY` completeness, `GET /docs/validation-errors` HTTP response, format consistency across all codes and all sensitive fields.
