# Stellar Transaction Envelope Inspection

The XDR Inspection API provides administrative tools to decode and analyze Stellar transaction envelopes (XDR). This facilitates debugging, transaction verification, and security audits.

## Endpoints

### POST /admin/inspect/xdr
Inspect an arbitrary Stellar transaction envelope.

**Authentication:** Admin API Key required.

**Body:**
```json
{
  "xdr": "AAAAAgAAAABnu6DlvW89y4qXgZ23bA1w8sX/uV6G9v9Y4L+0N1m4WAAAAZAABm8wAAAABAAAAAAAAAAAAAAABAAAAAAAAAAEAAAAA57ug5b1vPcuKl4Gdt2wNcPLF/7lehvb/WOC/tDdZuFgAAAAAAAAAAACYloAAAAAAAAAAAA==",
  "network": "testnet"
}
```

- `xdr` (string, required): The base64-encoded transaction envelope.
- `network` (string, optional, default: `testnet`): The network to use for decoding (`testnet` or `public`).

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "hash": "...",
    "network": "TESTNET",
    "source": "G...",
    "fee": 100,
    "memo": { "type": "text", "value": "..." },
    "operationCount": 1,
    "operations": [...],
    "timeBounds": null,
    "sequence": "..."
  }
}
```

---

### GET /admin/inspect/xdr/:transactionId
Retrieve and inspect a transaction stored in the local database.

**Authentication:** Admin API Key required.

- `transactionId` (string, required): The local UUID of the transaction.

**Success Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "localTransaction": {
      "id": "...",
      "status": "completed",
      "stellarTxId": "..."
    },
    "decoded": {
      "hash": "...",
      "source": "G...",
      "fee": 100,
      "memo": { ... },
      "operations": [...]
    },
    "raw": "..."
  }
}
```

## Security Rationale
These endpoints are restricted to users with the `admin` role. They provide deep visibility into the transactional data, which is essential for troubleshooting donation flows and ensuring data integrity between the API and the Stellar blockchain.
