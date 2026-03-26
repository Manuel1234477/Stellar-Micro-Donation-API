# Fee Installment Payments

## Overview

Parents may pay a required student fee in multiple installments rather than a single lump sum. This feature tracks the total expected fee per student, aggregates all installment payments, and always shows the correct outstanding balance.

## Database

Two new tables:

```sql
student_fees (
  id             INTEGER PRIMARY KEY,
  studentId      TEXT NOT NULL,
  description    TEXT NOT NULL,
  totalAmount    REAL NOT NULL,
  paidAmount     REAL NOT NULL DEFAULT 0,
  createdAt      DATETIME,
  updatedAt      DATETIME
)

fee_payments (
  id      INTEGER PRIMARY KEY,
  feeId   INTEGER NOT NULL REFERENCES student_fees(id),
  amount  REAL NOT NULL,
  note    TEXT,
  paidAt  DATETIME
)
```

`paidAmount` on `student_fees` is updated atomically with each payment insert, so balance queries are a single read.

## API

### Create a fee (admin only)

```
POST /fees
x-api-key: <admin-key>
{ "studentId": "stu-001", "description": "Term 1 Tuition", "totalAmount": 750 }
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "id": 1, "studentId": "stu-001", "description": "Term 1 Tuition",
    "totalAmount": 750, "paidAmount": 0, "remainingBalance": 750, "isPaid": false
  }
}
```

### Record an installment payment

```
POST /fees/:id/payments
{ "amount": 250, "note": "January instalment" }
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "totalAmount": 750, "paidAmount": 250, "remainingBalance": 500, "isPaid": false
  }
}
```

Errors:
- `400` — invalid amount or fee ID
- `404` — fee not found
- `422` — payment exceeds outstanding balance

### Get fee with payment history

```
GET /fees/:id
```

Response includes `payments[]` array with each installment.

### List fees for a student

```
GET /fees/student/:studentId
```

## Business Rules

- `paidAmount` is the sum of all recorded installments.
- `remainingBalance = totalAmount - paidAmount` (never below 0).
- `isPaid = remainingBalance === 0`.
- Payments that would exceed the outstanding balance are rejected with `422`.
- Only admins can create fee records; any authenticated user can record payments and query fees.

## Files

- `src/services/FeeService.js`
- `src/routes/fees.js`
- `src/routes/app.js` — registers `/fees` route
- `src/scripts/initDB.js` — creates `student_fees` and `fee_payments` tables
- `tests/globalSetup.js` — test DB schema
- `tests/implement-fee-installment-payments.test.js`
