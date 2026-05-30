# Payment Channels Admin API

## Overview

This document describes the admin endpoints for managing Stellar payment channels, implemented as part of Issue #122.

Payment channels are off-chain payment mechanisms that allow multiple payments to be batched and settled on-chain in a single transaction. They are particularly useful for high-frequency micro-donations where the Stellar base fee per transaction would be prohibitive.

## Endpoints

### GET /admin/payment-channels

Lists all payment channels with optional filtering and pagination.

**Query Parameters:**
- `status` (optional): Filter by channel status (`open`, `closing`, `closed`, `settled`, `disputed`)
- `limit` (optional, default: 50): Number of results per page
- `offset` (optional, default: 0): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "senderPublicKey": "GXXX...",
      "recipientPublicKey": "GYYY...",
      "capacity": 100.0,
      "used": 30.0,
      "remaining": 70.0,
      "status": "open",
      "openedAt": "2024-01-01T00:00:00.000Z",
      "expiresAt": "2024-01-08T00:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 100,
    "hasMore": true
  }
}
```

**Authorization:** Requires admin role

---

### GET /admin/payment-channels/stats

Returns aggregate statistics for all payment channels.

**Response:**
```json
{
  "success": true,
  "data": {
    "activeChannels": 42,
    "totalCapacityXLM": "10000.0000000",
    "totalUsedXLM": "3500.0000000",
    "channelsExpiringSoon": 5,
    "totalChannels": 50,
    "byStatus": {
      "open": 42,
      "closing": 2,
      "closed": 3,
      "settled": 2,
      "disputed": 1
    }
  }
}
```

**Notes:**
- `channelsExpiringSoon` counts channels expiring within 24 hours
- `totalCapacityXLM` and `totalUsedXLM` only include active (open) channels

**Authorization:** Requires admin role

---

### GET /admin/payment-channels/:id

Returns full details for a specific payment channel, including transaction history.

**Path Parameters:**
- `id`: Channel UUID

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "senderPublicKey": "GXXX...",
    "recipientPublicKey": "GYYY...",
    "capacity": 100.0,
    "balance": 30.0,
    "sequence": 5,
    "status": "open",
    "openedAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-05T12:00:00.000Z",
    "settledAt": null,
    "closedAt": null,
    "disputedAt": null,
    "disputeSequence": null,
    "metadata": {
      "note": "High-frequency donor channel",
      "expiresAt": "2024-01-08T00:00:00.000Z"
    },
    "transactionHistory": [
      {
        "sequence": 1,
        "senderSig": "abc123...",
        "receiverSig": "def456...",
        "timestamp": "2024-01-02T10:00:00.000Z"
      }
    ]
  }
}
```

**Authorization:** Requires admin role

---

### POST /admin/payment-channels/:id/close

Initiates a cooperative channel closure, settling the final balance on-chain.

**Path Parameters:**
- `id`: Channel UUID

**Request Body:**
```json
{
  "senderSecret": "SXXX..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "settled",
    "settledAt": "2024-01-05T15:30:00.000Z",
    "balanceSettled": 30.0,
    "stellarTxId": "abc123..."
  },
  "message": "Payment channel closed successfully"
}
```

**Notes:**
- The channel must be in `open` or `disputed` status
- If the channel has a non-zero balance, it will be settled on-chain
- The operation is idempotent - attempting to close an already closed channel returns a 409 Conflict error

**Authorization:** Requires admin role

---

## Channel Lifecycle

Payment channels follow this lifecycle:

1. **open** - Active channel accepting off-chain payments
2. **closing** - Cooperative close initiated (optional intermediate state)
3. **settled** - Final balance settled on-chain via cooperative close
4. **closed** - Channel force-closed (timeout or dispute resolution)
5. **disputed** - Dispute raised, awaiting resolution

## Implementation Details

### Files Created/Modified

1. **src/routes/admin/paymentChannels.js** - Admin route handlers
2. **src/config/serviceContainer.js** - Added PaymentChannelService to DI container
3. **src/routes/app.js** - Registered payment channels admin routes
4. **tests/admin/payment-channels.test.js** - Comprehensive test suite

### Service Integration

The endpoints use the existing `PaymentChannelService` from `src/services/PaymentChannelService.js`, which implements:
- Channel opening and funding
- Off-chain state updates with dual signatures
- On-chain settlement
- Dispute handling
- Force closure for timed-out channels

### Security

- All endpoints require admin role via `checkPermission(PERMISSIONS.ADMIN_ALL)`
- Audit logging for channel closure operations
- Input validation for status filters and required fields
- Proper error handling with appropriate HTTP status codes

## Testing

The test suite covers:
- ✅ Listing channels with pagination
- ✅ Filtering channels by status
- ✅ Aggregate statistics calculation
- ✅ Channel detail retrieval with transaction history
- ✅ Cooperative channel closure
- ✅ Authorization checks
- ✅ Error cases (invalid status, non-existent channels, duplicate closes)

Run tests with:
```bash
npm test tests/admin/payment-channels.test.js
```

## Future Enhancements

Potential improvements for future iterations:

1. **Batch Operations** - Close multiple channels in a single request
2. **Channel Monitoring** - Automated alerts for channels nearing capacity or expiration
3. **Analytics Dashboard** - Visualizations of channel usage patterns
4. **Channel Templates** - Pre-configured channel settings for common use cases
5. **Dispute Resolution UI** - Admin interface for reviewing and resolving disputes
