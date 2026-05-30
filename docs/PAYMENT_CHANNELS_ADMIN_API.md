# Payment Channels Admin API

**Issue #122**: Add GET /admin/payment-channels and channel management endpoints

## Overview

The Payment Channels Admin API provides operators with visibility and control over Stellar payment channels. Payment channels are off-chain payment mechanisms that allow multiple payments to be batched and settled on-chain in a single transaction, reducing transaction fees for high-frequency micro-donations.

## Endpoints

### 1. List Payment Channels

**GET** `/admin/payment-channels`

Lists all active payment channels with pagination support.

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `status` | string | No | - | Filter by status: `open`, `closing`, `closed`, `settled`, `disputed` |
| `limit` | integer | No | 50 | Number of results per page |
| `offset` | integer | No | 0 | Pagination offset |

#### Response

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "senderPublicKey": "GXXX...",
      "recipientPublicKey": "GYYY...",
      "capacity": 100.0,
      "used": 30.5,
      "remaining": 69.5,
      "status": "open",
      "openedAt": "2026-05-31T10:00:00.000Z",
      "expiresAt": "2026-06-07T10:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 150,
    "hasMore": true
  }
}
```

#### Example

```bash
# List all open channels
curl -X GET "https://api.example.com/admin/payment-channels?status=open" \
  -H "X-API-Key: your-admin-key"

# Get second page with 25 results per page
curl -X GET "https://api.example.com/admin/payment-channels?limit=25&offset=25" \
  -H "X-API-Key: your-admin-key"
```

---

### 2. Get Channel Statistics

**GET** `/admin/payment-channels/stats`

Returns aggregate statistics for all payment channels.

#### Response

```json
{
  "success": true,
  "data": {
    "activeChannels": 42,
    "totalCapacityXLM": "4200.0000000",
    "totalUsedXLM": "1250.5000000",
    "channelsExpiringSoon": 5,
    "totalChannels": 150,
    "byStatus": {
      "open": 42,
      "closing": 3,
      "closed": 80,
      "settled": 20,
      "disputed": 5
    }
  }
}
```

#### Fields

- `activeChannels`: Number of channels with status `open`
- `totalCapacityXLM`: Total capacity across all active channels
- `totalUsedXLM`: Total amount used across all active channels
- `channelsExpiringSoon`: Channels expiring within 24 hours
- `totalChannels`: Total number of channels (all statuses)
- `byStatus`: Breakdown of channels by status

#### Example

```bash
curl -X GET "https://api.example.com/admin/payment-channels/stats" \
  -H "X-API-Key: your-admin-key"
```

---

### 3. Get Channel Details

**GET** `/admin/payment-channels/:id`

Returns full details for a specific payment channel, including transaction history.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Channel UUID |

#### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "senderPublicKey": "GXXX...",
    "recipientPublicKey": "GYYY...",
    "capacity": 100.0,
    "balance": 30.5,
    "sequence": 5,
    "status": "open",
    "openedAt": "2026-05-31T10:00:00.000Z",
    "updatedAt": "2026-05-31T12:30:00.000Z",
    "settledAt": null,
    "closedAt": null,
    "disputedAt": null,
    "disputeSequence": null,
    "metadata": {
      "note": "High-frequency donor channel",
      "expiresAt": "2026-06-07T10:00:00.000Z"
    },
    "transactionHistory": [
      {
        "sequence": 1,
        "senderSig": "abc123...",
        "receiverSig": "def456...",
        "timestamp": "2026-05-31T10:15:00.000Z"
      },
      {
        "sequence": 2,
        "senderSig": "ghi789...",
        "receiverSig": "jkl012...",
        "timestamp": "2026-05-31T11:00:00.000Z"
      }
    ]
  }
}
```

#### Example

```bash
curl -X GET "https://api.example.com/admin/payment-channels/550e8400-e29b-41d4-a716-446655440000" \
  -H "X-API-Key: your-admin-key"
```

---

### 4. Close Payment Channel

**POST** `/admin/payment-channels/:id/close`

Initiates a cooperative channel closure, settling the final balance on-chain.

#### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Channel UUID |

#### Request Body

```json
{
  "senderSecret": "SXXX..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `senderSecret` | string | Yes | Sender's Stellar secret key to authorize settlement |

#### Response

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "status": "settled",
    "settledAt": "2026-05-31T13:00:00.000Z",
    "balanceSettled": 30.5,
    "stellarTxId": "abc123..."
  },
  "message": "Payment channel closed successfully"
}
```

#### Example

```bash
curl -X POST "https://api.example.com/admin/payment-channels/550e8400-e29b-41d4-a716-446655440000/close" \
  -H "X-API-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "senderSecret": "SXXX..."
  }'
```

---

## Authorization

All endpoints require **admin role**. Requests without admin privileges will receive a `403 Forbidden` response.

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions"
  }
}
```

---

## Error Responses

### 400 Bad Request

Invalid request parameters or validation errors.

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid status. Must be one of: open, closing, closed, settled, disputed"
  }
}
```

### 404 Not Found

Channel does not exist.

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Payment channel 550e8400-e29b-41d4-a716-446655440000 not found"
  }
}
```

### 409 Conflict

Channel is already closed or in an invalid state for the requested operation.

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "Channel is already settled"
  }
}
```

---

## Channel Lifecycle

Payment channels follow this lifecycle:

1. **open** - Active channel accepting off-chain payments
2. **closing** - Cooperative close initiated (optional intermediate state)
3. **settled** - Final balance settled on-chain via cooperative close
4. **closed** - Force-closed due to timeout or dispute resolution
5. **disputed** - Dispute raised, awaiting resolution

### State Transitions

```
open → settled (cooperative close)
open → disputed (dispute raised)
open → closed (force close after timeout)
disputed → closed (dispute resolved)
```

---

## Use Cases

### Monitor Active Channels

```bash
# Get overview of all active channels
curl -X GET "https://api.example.com/admin/payment-channels/stats" \
  -H "X-API-Key: admin-key"

# List channels expiring soon
curl -X GET "https://api.example.com/admin/payment-channels?status=open" \
  -H "X-API-Key: admin-key" | jq '.data[] | select(.expiresAt < "2026-06-01")'
```

### Investigate Channel Activity

```bash
# Get full details and transaction history
curl -X GET "https://api.example.com/admin/payment-channels/550e8400-e29b-41d4-a716-446655440000" \
  -H "X-API-Key: admin-key"
```

### Close Inactive Channels

```bash
# Close a channel that's no longer needed
curl -X POST "https://api.example.com/admin/payment-channels/550e8400-e29b-41d4-a716-446655440000/close" \
  -H "X-API-Key: admin-key" \
  -H "Content-Type: application/json" \
  -d '{"senderSecret": "SXXX..."}'
```

---

## Implementation Details

### Files

- **Route Handler**: `src/routes/admin/paymentChannels.js`
- **Service Layer**: `src/services/PaymentChannelService.js`
- **Tests**: `tests/admin/payment-channels.test.js`

### Dependencies

- `PaymentChannelService` - Core payment channel logic
- `StellarService` - On-chain settlement operations
- `AuditLogService` - Audit logging for channel closures
- `serviceContainer` - Dependency injection

### Audit Logging

Channel closure operations are automatically logged to the audit log:

```json
{
  "category": "SYSTEM",
  "action": "PAYMENT_CHANNEL_CLOSED",
  "severity": "MEDIUM",
  "result": "SUCCESS",
  "details": {
    "channelId": "uuid",
    "balanceSettled": 30.5,
    "senderKey": "GXXX...",
    "receiverKey": "GYYY...",
    "stellarTxId": "abc123..."
  }
}
```

---

## Testing

Comprehensive test coverage is provided in `tests/admin/payment-channels.test.js`:

- ✅ List all payment channels
- ✅ Filter channels by status
- ✅ Paginate results
- ✅ Validate status filter
- ✅ Return aggregate statistics
- ✅ Count channels expiring soon
- ✅ Handle empty channel list
- ✅ Return full channel details
- ✅ Include transaction history
- ✅ Handle non-existent channels
- ✅ Close channel and settle balance
- ✅ Close channel with zero balance
- ✅ Reject closing without senderSecret
- ✅ Reject closing already closed channel
- ✅ Require admin role for all endpoints

Run tests:

```bash
npm test tests/admin/payment-channels.test.js
```

---

## Performance Considerations

- **Pagination**: Default limit of 50 channels per request to prevent large response payloads
- **Filtering**: Status filtering is performed at the database level for efficiency
- **Caching**: Consider implementing caching for the `/stats` endpoint if called frequently
- **Indexing**: Ensure database indexes on `status` and `createdAt` columns for optimal query performance

---

## Security

- **Admin-only access**: All endpoints require admin role
- **Secret key handling**: Sender secrets are never logged or stored
- **Audit trail**: All channel closures are logged for compliance
- **Input validation**: All parameters are validated before processing
- **Rate limiting**: Standard rate limits apply to prevent abuse

---

## Related Documentation

- [Payment Channels Service](../src/services/PaymentChannelService.js)
- [API Authentication](./authentication.md)
- [RBAC Permissions](./RBAC.md)
- [Audit Logging](./AUDIT_LOGGING.md)
