# API Examples - Stellar Micro-Donation API

Complete request and response examples for all API endpoints. Perfect for new contributors and integrators!

## Table of Contents

- [Authentication](#authentication)
- [Donations](#donations)
- [Wallets](#wallets)
- [Recurring Donations (Stream)](#recurring-donations-stream)
- [Statistics](#statistics)
- [Transactions](#transactions)
- [Health Check](#health-check)
- [Error Responses](#error-responses)

---

## Authentication

Most endpoints require an API key passed in the `X-API-Key` header.

```bash
curl -H "X-API-Key: your-api-key-here" \
  http://localhost:3000/donations
```

---

## Donations

### Create a Donation

**Endpoint:** `POST /donations`

**Headers:**
- `X-API-Key`: Your API key (required)
- `Idempotency-Key`: Unique key to prevent duplicate transactions (required)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "amount": 10.5,
  "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
  "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
  "memo": "Coffee donation"
}
```

**Success Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "verified": true,
    "transactionHash": "abc123def456"
  }
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/donations \
  -H "X-API-Key: your-api-key-here" \
  -H "Idempotency-Key: unique-key-123" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10.5,
    "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
    "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
    "memo": "Coffee donation"
  }'
```

**Error Response - Missing Required Fields (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "MISSING_REQUIRED_FIELD",
    "message": "Missing required fields: amount, recipient"
  }
}
```

**Error Response - Invalid Amount (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "AMOUNT_TOO_LOW",
    "message": "Amount must be at least 0.01 XLM",
    "limits": {
      "min": 0.01,
      "max": 10000
    }
  }
}
```

**Error Response - Daily Limit Exceeded (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "DAILY_LIMIT_EXCEEDED",
    "message": "Daily donation limit exceeded",
    "dailyLimit": 1000,
    "currentDailyTotal": 950,
    "remainingDaily": 50
  }
}
```

**Error Response - Invalid Memo (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "MEMO_TOO_LONG",
    "message": "Memo exceeds maximum length of 28 bytes",
    "maxLength": 28,
    "currentLength": 35
  }
}
```

---

### Get All Donations

**Endpoint:** `GET /donations`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "amount": 10.5,
      "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
      "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
      "memo": "Coffee donation",
      "timestamp": "2024-02-23T10:30:00.000Z",
      "status": "confirmed"
    },
    {
      "id": "2",
      "amount": 5.0,
      "donor": "Anonymous",
      "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
      "memo": "",
      "timestamp": "2024-02-23T11:15:00.000Z",
      "status": "confirmed"
    }
  ],
  "count": 2
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/donations \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Recent Donations

**Endpoint:** `GET /donations/recent?limit=10`

**Query Parameters:**
- `limit` (optional): Number of recent donations to return (default: 10, max: 100)

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "5",
      "amount": 25.0,
      "donor": "GDONOR789EXAMPLEPUBLICKEY123456ABCDEFGHIJKLMNOPQRST",
      "recipient": "GRECIPIENT123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNO",
      "timestamp": "2024-02-23T14:20:00.000Z",
      "status": "confirmed"
    }
  ],
  "count": 1,
  "limit": 10
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/donations/recent?limit=5" \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Invalid Limit (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_LIMIT",
    "message": "Invalid limit parameter. Must be a positive number."
  }
}
```

---

### Get Specific Donation

**Endpoint:** `GET /donations/:id`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "1",
    "amount": 10.5,
    "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
    "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
    "memo": "Coffee donation",
    "timestamp": "2024-02-23T10:30:00.000Z",
    "status": "confirmed",
    "stellarTxId": "abc123def456",
    "analyticsFee": 0.105,
    "analyticsFeePercentage": 1
  }
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/donations/1 \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Not Found (404 Not Found):**
```json
{
  "success": false,
  "error": {
    "code": "DONATION_NOT_FOUND",
    "message": "Donation not found"
  }
}
```

---
### Get Donation Limits

**Endpoint:** `GET /donations/limits`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "minAmount": 0.01,
    "maxAmount": 10000,
    "maxDailyPerDonor": 1000,
    "currency": "XLM"
  }
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/donations/limits \
  -H "X-API-Key: your-api-key-here"
```

---

### Verify Transaction

**Endpoint:** `POST /donations/verify`

**Headers:**
- `X-API-Key`: Your API key (required)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "transactionHash": "abc123def456789"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "verified": true,
    "transactionId": "abc123def456789",
    "ledger": 12345678,
    "amount": "10.5000000",
    "source": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
    "destination": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
    "timestamp": "2024-02-23T10:30:00Z"
  }
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/donations/verify \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{"transactionHash": "abc123def456789"}'
```

**Error Response - Transaction Not Found (404 Not Found):**
```json
{
  "success": false,
  "error": {
    "code": "TRANSACTION_NOT_FOUND",
    "message": "Transaction not found on the Stellar network"
  }
}
```

---

### Update Donation Status

**Endpoint:** `PATCH /donations/:id/status`

**Headers:**
- `X-API-Key`: Your API key (required)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "status": "confirmed",
  "stellarTxId": "abc123def456",
  "ledger": 12345678
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "1",
    "amount": 10.5,
    "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
    "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
    "status": "confirmed",
    "stellarTxId": "abc123def456",
    "ledger": 12345678,
    "confirmedAt": "2024-02-23T10:30:00.000Z"
  }
}
```

**Example with cURL:**
```bash
curl -X PATCH http://localhost:3000/donations/1/status \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "confirmed",
    "stellarTxId": "abc123def456",
    "ledger": 12345678
  }'
```

**Error Response - Invalid Status (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid status. Must be one of: pending, submitted, confirmed, failed"
  }
}
```

---

## Wallets

### Create a Wallet

**Endpoint:** `POST /wallets`

**Headers:**
- `X-API-Key`: Your API key (required)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "address": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
  "label": "My Donation Wallet",
  "ownerName": "John Doe"
}
```

**Success Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "1",
    "address": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
    "label": "My Donation Wallet",
    "ownerName": "John Doe",
    "createdAt": "2024-02-23T10:30:00.000Z"
  }
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/wallets \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "address": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
    "label": "My Donation Wallet",
    "ownerName": "John Doe"
  }'
```

**Error Response - Missing Address (400 Bad Request):**
```json
{
  "error": "Missing required field: address"
}
```

**Error Response - Wallet Already Exists (409 Conflict):**
```json
{
  "error": "Wallet with this address already exists"
}
```

---

### Get All Wallets

**Endpoint:** `GET /wallets`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "address": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
      "label": "My Donation Wallet",
      "ownerName": "John Doe",
      "createdAt": "2024-02-23T10:30:00.000Z"
    },
    {
      "id": "2",
      "address": "GWALLET456EXAMPLEPUBLICKEY123789ABCDEFGHIJKLMNOPQRS",
      "label": "Charity Wallet",
      "ownerName": "Jane Smith",
      "createdAt": "2024-02-23T11:00:00.000Z"
    }
  ],
  "count": 2
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/wallets \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Specific Wallet

**Endpoint:** `GET /wallets/:id`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "1",
    "address": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
    "label": "My Donation Wallet",
    "ownerName": "John Doe",
    "createdAt": "2024-02-23T10:30:00.000Z"
  }
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/wallets/1 \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Not Found (404 Not Found):**
```json
{
  "error": "Wallet not found"
}
```

---

### Update Wallet Metadata

**Endpoint:** `PATCH /wallets/:id`

**Headers:**
- `X-API-Key`: Your API key (required)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "label": "Updated Wallet Label",
  "ownerName": "John Updated Doe"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "1",
    "address": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
    "label": "Updated Wallet Label",
    "ownerName": "John Updated Doe",
    "createdAt": "2024-02-23T10:30:00.000Z",
    "updatedAt": "2024-02-23T15:45:00.000Z"
  }
}
```

**Example with cURL:**
```bash
curl -X PATCH http://localhost:3000/wallets/1 \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Updated Wallet Label",
    "ownerName": "John Updated Doe"
  }'
```

**Error Response - No Fields Provided (400 Bad Request):**
```json
{
  "error": "At least one field (label or ownerName) is required"
}
```

---

### Get Wallet Transactions

**Endpoint:** `GET /wallets/:publicKey/transactions`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "sender": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
      "receiver": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
      "amount": 10.5,
      "memo": "Coffee donation",
      "timestamp": "2024-02-23T10:30:00.000Z"
    },
    {
      "id": 2,
      "sender": "GDONOR789EXAMPLEPUBLICKEY123456ABCDEFGHIJKLMNOPQRST",
      "receiver": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
      "amount": 25.0,
      "memo": "Thank you!",
      "timestamp": "2024-02-23T11:15:00.000Z"
    }
  ],
  "count": 2
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/wallets/GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS/transactions \
  -H "X-API-Key: your-api-key-here"
```

**Success Response - No Transactions (200 OK):**
```json
{
  "success": true,
  "data": [],
  "count": 0,
  "message": "No user found with this public key"
}
```

---

## Recurring Donations (Stream)

### Create Recurring Donation Schedule

**Endpoint:** `POST /stream/create`

**Headers:**
- `X-API-Key`: Your API key (required)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "donorPublicKey": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
  "recipientPublicKey": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
  "amount": 5.0,
  "frequency": "weekly"
}
```

**Success Response (201 Created):**
```json
{
  "success": true,
  "message": "Recurring donation schedule created successfully",
  "data": {
    "scheduleId": 1,
    "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
    "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
    "amount": 5.0,
    "frequency": "weekly",
    "nextExecution": "2024-03-01T10:30:00.000Z",
    "status": "active",
    "executionCount": 0
  }
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/stream/create \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "donorPublicKey": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
    "recipientPublicKey": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
    "amount": 5.0,
    "frequency": "weekly"
  }'
```

**Error Response - Missing Fields (400 Bad Request):**
```json
{
  "success": false,
  "error": "Missing required fields: donorPublicKey, recipientPublicKey, amount, frequency"
}
```

**Error Response - Invalid Frequency (400 Bad Request):**
```json
{
  "success": false,
  "error": "Frequency must be one of: daily, weekly, monthly"
}
```

**Error Response - Self-Donation (400 Bad Request):**
```json
{
  "success": false,
  "error": "Donor and recipient cannot be the same"
}
```

**Error Response - Wallet Not Found (404 Not Found):**
```json
{
  "success": false,
  "error": "Donor wallet not found"
}
```

---

### Get All Recurring Schedules

**Endpoint:** `GET /stream/schedules`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "amount": 5.0,
      "frequency": "weekly",
      "startDate": "2024-02-23T10:30:00.000Z",
      "nextExecutionDate": "2024-03-01T10:30:00.000Z",
      "lastExecutionDate": null,
      "status": "active",
      "executionCount": 0,
      "donorPublicKey": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
      "recipientPublicKey": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR"
    }
  ],
  "count": 1
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/stream/schedules \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Specific Recurring Schedule

**Endpoint:** `GET /stream/schedules/:id`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "amount": 5.0,
    "frequency": "weekly",
    "startDate": "2024-02-23T10:30:00.000Z",
    "nextExecutionDate": "2024-03-01T10:30:00.000Z",
    "lastExecutionDate": "2024-02-23T10:30:00.000Z",
    "status": "active",
    "executionCount": 1,
    "donorPublicKey": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
    "recipientPublicKey": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR"
  }
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/stream/schedules/1 \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Not Found (404 Not Found):**
```json
{
  "success": false,
  "error": "Schedule not found"
}
```

---

### Cancel Recurring Schedule

**Endpoint:** `DELETE /stream/schedules/:id`

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "message": "Recurring donation schedule cancelled successfully"
}
```

**Example with cURL:**
```bash
curl -X DELETE http://localhost:3000/stream/schedules/1 \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Not Found (404 Not Found):**
```json
{
  "success": false,
  "error": "Schedule not found"
}
```

---

## Statistics

### Get Daily Statistics

**Endpoint:** `GET /stats/daily?startDate=2024-02-01&endDate=2024-02-28`

**Query Parameters:**
- `startDate` (required): Start date in ISO format (YYYY-MM-DD)
- `endDate` (required): End date in ISO format (YYYY-MM-DD)

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "date": "2024-02-23",
      "totalAmount": 150.5,
      "transactionCount": 12,
      "uniqueDonors": 8,
      "uniqueRecipients": 3
    },
    {
      "date": "2024-02-24",
      "totalAmount": 200.0,
      "transactionCount": 15,
      "uniqueDonors": 10,
      "uniqueRecipients": 4
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-01T00:00:00.000Z",
      "end": "2024-02-28T23:59:59.999Z"
    },
    "totalDays": 2,
    "aggregationType": "daily"
  }
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/stats/daily?startDate=2024-02-01&endDate=2024-02-28" \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Missing Date Parameters (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "MISSING_DATE_PARAMS",
    "message": "Both startDate and endDate are required"
  }
}
```

**Error Response - Invalid Date Format (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_DATE_FORMAT",
    "message": "Invalid date format. Use ISO format (YYYY-MM-DD)"
  }
}
```

---

### Get Weekly Statistics

**Endpoint:** `GET /stats/weekly?startDate=2024-02-01&endDate=2024-02-28`

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "weekStart": "2024-02-19",
      "weekEnd": "2024-02-25",
      "totalAmount": 850.5,
      "transactionCount": 45,
      "uniqueDonors": 28,
      "uniqueRecipients": 12
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-01T00:00:00.000Z",
      "end": "2024-02-28T23:59:59.999Z"
    },
    "totalWeeks": 1,
    "aggregationType": "weekly"
  }
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/stats/weekly?startDate=2024-02-01&endDate=2024-02-28" \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Summary Statistics

**Endpoint:** `GET /stats/summary?startDate=2024-02-01&endDate=2024-02-28`

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "totalAmount": 5250.75,
    "totalTransactions": 125,
    "uniqueDonors": 45,
    "uniqueRecipients": 18,
    "averageDonation": 42.01,
    "largestDonation": 500.0,
    "smallestDonation": 0.5,
    "dateRange": {
      "start": "2024-02-01T00:00:00.000Z",
      "end": "2024-02-28T23:59:59.999Z"
    }
  }
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/stats/summary?startDate=2024-02-01&endDate=2024-02-28" \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Donor Statistics

**Endpoint:** `GET /stats/donors?startDate=2024-02-01&endDate=2024-02-28`

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
      "totalAmount": 250.5,
      "transactionCount": 15,
      "averageDonation": 16.7,
      "firstDonation": "2024-02-01T10:00:00.000Z",
      "lastDonation": "2024-02-28T15:30:00.000Z"
    },
    {
      "donor": "Anonymous",
      "totalAmount": 125.0,
      "transactionCount": 25,
      "averageDonation": 5.0,
      "firstDonation": "2024-02-05T12:00:00.000Z",
      "lastDonation": "2024-02-27T18:45:00.000Z"
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-01T00:00:00.000Z",
      "end": "2024-02-28T23:59:59.999Z"
    },
    "totalDonors": 2
  }
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/stats/donors?startDate=2024-02-01&endDate=2024-02-28" \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Recipient Statistics

**Endpoint:** `GET /stats/recipients?startDate=2024-02-01&endDate=2024-02-28`

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
      "totalAmount": 1250.75,
      "transactionCount": 45,
      "averageDonation": 27.79,
      "firstDonation": "2024-02-01T09:00:00.000Z",
      "lastDonation": "2024-02-28T16:20:00.000Z",
      "uniqueDonors": 28
    }
  ],
  "metadata": {
    "dateRange": {
      "start": "2024-02-01T00:00:00.000Z",
      "end": "2024-02-28T23:59:59.999Z"
    },
    "totalRecipients": 1
  }
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/stats/recipients?startDate=2024-02-01&endDate=2024-02-28" \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Analytics Fee Statistics

**Endpoint:** `GET /stats/analytics-fees?startDate=2024-02-01&endDate=2024-02-28`

**Query Parameters:**
- `startDate` (required): Start date in ISO format
- `endDate` (required): End date in ISO format

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "totalFees": 52.51,
    "totalDonations": 5250.75,
    "feePercentage": 1,
    "transactionCount": 125,
    "dateRange": {
      "start": "2024-02-01T00:00:00.000Z",
      "end": "2024-02-28T23:59:59.999Z"
    }
  },
  "metadata": {
    "note": "Analytics fees are calculated but not deducted on-chain"
  }
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/stats/analytics-fees?startDate=2024-02-01&endDate=2024-02-28" \
  -H "X-API-Key: your-api-key-here"
```

---

### Get Wallet Analytics

**Endpoint:** `GET /stats/wallet/:walletAddress/analytics`

**Query Parameters (Optional):**
- `startDate`: Start date in ISO format
- `endDate`: End date in ISO format

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "walletAddress": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS",
    "sent": {
      "totalAmount": 450.5,
      "transactionCount": 25,
      "averageAmount": 18.02
    },
    "received": {
      "totalAmount": 1250.75,
      "transactionCount": 45,
      "averageAmount": 27.79
    },
    "netBalance": 800.25,
    "totalTransactions": 70,
    "uniqueCounterparties": 32,
    "firstTransaction": "2024-01-15T10:00:00.000Z",
    "lastTransaction": "2024-02-28T16:20:00.000Z"
  }
}
```

**Example with cURL (All Time):**
```bash
curl -X GET http://localhost:3000/stats/wallet/GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS/analytics \
  -H "X-API-Key: your-api-key-here"
```

**Example with cURL (Date Range):**
```bash
curl -X GET "http://localhost:3000/stats/wallet/GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS/analytics?startDate=2024-02-01&endDate=2024-02-28" \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Missing Wallet Address (400 Bad Request):**
```json
{
  "error": "Missing required parameter: walletAddress"
}
```

**Error Response - Invalid Date Range (400 Bad Request):**
```json
{
  "error": "Both startDate and endDate are required for date filtering"
}
```

---

## Transactions

### Get Paginated Transactions

**Endpoint:** `GET /transactions?limit=10&offset=0`

**Query Parameters:**
- `limit` (optional): Number of transactions per page (default: 10)
- `offset` (optional): Number of transactions to skip (default: 0)

**Headers:**
- `X-API-Key`: Your API key (required)

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "1",
      "amount": 10.5,
      "donor": "GDONOR123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRST",
      "recipient": "GRECIPIENT456EXAMPLEPUBLICKEY789ABCDEFGHIJKLMNOPQR",
      "timestamp": "2024-02-23T10:30:00.000Z",
      "status": "confirmed"
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 125,
    "hasMore": true
  }
}
```

**Example with cURL:**
```bash
curl -X GET "http://localhost:3000/transactions?limit=20&offset=0" \
  -H "X-API-Key: your-api-key-here"
```

**Error Response - Invalid Limit (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_LIMIT",
    "message": "Limit must be a positive number"
  }
}
```

**Error Response - Invalid Offset (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_OFFSET",
    "message": "Offset must be a non-negative number"
  }
}
```

---

### Sync Wallet Transactions

**Endpoint:** `POST /transactions/sync`

**Headers:**
- `X-API-Key`: Your API key (required)
- `Content-Type`: application/json

**Request Body:**
```json
{
  "publicKey": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "synced": 15,
    "newTransactions": 3,
    "updatedTransactions": 2,
    "lastSyncedLedger": 12345678,
    "syncedAt": "2024-02-23T15:30:00.000Z"
  }
}
```

**Example with cURL:**
```bash
curl -X POST http://localhost:3000/transactions/sync \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "GWALLET123EXAMPLEPUBLICKEY456789ABCDEFGHIJKLMNOPQRS"
  }'
```

**Error Response - Missing Public Key (400 Bad Request):**
```json
{
  "success": false,
  "error": {
    "code": "MISSING_PUBLIC_KEY",
    "message": "publicKey is required"
  }
}
```

**Error Response - Sync Failed (500 Internal Server Error):**
```json
{
  "success": false,
  "error": {
    "code": "SYNC_FAILED",
    "message": "Failed to sync transactions from Stellar network"
  }
}
```

---

## Health Check

### Check API Health

**Endpoint:** `GET /health`

**No authentication required**

**Success Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2024-02-23T15:30:00.000Z",
  "dependencies": {
    "database": "ok"
  }
}
```

**Example with cURL:**
```bash
curl -X GET http://localhost:3000/health
```

**Unhealthy Response (503 Service Unavailable):**
```json
{
  "status": "unhealthy",
  "timestamp": "2024-02-23T15:30:00.000Z",
  "dependencies": {
    "database": "unavailable"
  }
}
```

---

## Error Responses

### Common Error Codes

All error responses follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  }
}
```

### HTTP Status Codes

- `200 OK` - Request succeeded
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Missing or invalid API key
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource already exists
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service temporarily unavailable

### Authentication Errors

**Missing API Key (401 Unauthorized):**
```json
{
  "error": "API key is required"
}
```

**Invalid API Key (401 Unauthorized):**
```json
{
  "error": "Invalid API key"
}
```

### Rate Limiting Errors

**Rate Limit Exceeded (429 Too Many Requests):**
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many requests. Please try again later.",
    "retryAfter": 60
  }
}
```

### Validation Errors

**Malformed Request (400 Bad Request):**
```json
{
  "success": false,
  "error": "Malformed request: donor and recipient must be strings"
}
```

**Invalid JSON (400 Bad Request):**
```json
{
  "error": "Invalid JSON in request body"
}
```

### Server Errors

**Internal Server Error (500):**
```json
{
  "success": false,
  "error": "An unexpected error occurred",
  "message": "Internal server error"
}
```

**Stellar Network Error (500):**
```json
{
  "success": false,
  "error": "Failed to communicate with Stellar network",
  "message": "Network timeout"
}
```

---

## Tips for Integration

### Best Practices

1. **Always use Idempotency Keys** for donation creation to prevent duplicate transactions
2. **Store API keys securely** - never commit them to version control
3. **Handle rate limits gracefully** - implement exponential backoff
4. **Validate input** on the client side before sending requests
5. **Check the health endpoint** before making critical operations
6. **Use pagination** for large result sets
7. **Implement proper error handling** for all API calls

### Example: Creating a Donation with Error Handling (JavaScript)

```javascript
async function createDonation(amount, donor, recipient, memo) {
  const idempotencyKey = generateUniqueKey(); // Generate unique key
  
  try {
    const response = await fetch('http://localhost:3000/donations', {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.API_KEY,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount, donor, recipient, memo })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      // Handle specific error codes
      if (data.error?.code === 'DAILY_LIMIT_EXCEEDED') {
        console.error('Daily limit reached:', data.error.remainingDaily);
      } else if (data.error?.code === 'MEMO_TOO_LONG') {
        console.error('Memo too long:', data.error.currentLength);
      }
      throw new Error(data.error?.message || 'Donation failed');
    }
    
    return data;
  } catch (error) {
    console.error('Failed to create donation:', error);
    throw error;
  }
}
```

### Example: Fetching Statistics with Date Range (Python)

```python
import requests
from datetime import datetime, timedelta

def get_monthly_stats(api_key):
    end_date = datetime.now()
    start_date = end_date - timedelta(days=30)
    
    url = "http://localhost:3000/stats/summary"
    params = {
        "startDate": start_date.strftime("%Y-%m-%d"),
        "endDate": end_date.strftime("%Y-%m-%d")
    }
    headers = {"X-API-Key": api_key}
    
    try:
        response = requests.get(url, params=params, headers=headers)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        print(f"HTTP Error: {e.response.status_code}")
        print(f"Error details: {e.response.json()}")
        raise
```

---

## Need Help?

- Check the [main README](../README.md) for setup instructions
- Review the [Architecture Documentation](ARCHITECTURE.md) for system design
- See the [Quick Start Guide](guides/QUICK_START.md) for getting started
- Open an issue on GitHub for bugs or questions

---

**Last Updated:** February 23, 2024  
**API Version:** 1.0.0
