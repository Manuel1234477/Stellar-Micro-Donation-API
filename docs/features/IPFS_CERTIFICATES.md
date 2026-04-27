# IPFS Donation Impact Certificates

Donation impact certificates are pinned to IPFS on confirmation, creating an immutable, publicly verifiable record.

## How It Works

1. On donation confirmation, a certificate JSON is generated
2. The certificate is pinned to IPFS via Pinata (if credentials are configured)
3. The IPFS CID is stored in the transaction record
4. If pinning fails, the certificate is stored locally — **donation is never blocked**

## Certificate Format

```json
{
  "type": "DonationImpactCertificate",
  "version": "1.0",
  "donationId": 42,
  "donor": "GABC...XYZ",
  "recipient": "GXYZ...ABC",
  "amount": "10.0000000",
  "currency": "XLM",
  "memo": "optional memo",
  "issuedAt": "2024-01-01T00:00:00.000Z"
}
```

No PII beyond Stellar public keys is included.

## Endpoint

```
GET /donations/:id/certificate/ipfs
Authorization: Bearer <key>
```

Response:
```json
{
  "success": true,
  "data": {
    "donationId": 42,
    "cid": "QmABC...",
    "gateway": "https://gateway.pinata.cloud/ipfs/QmABC...",
    "pinned": true
  }
}
```

## Configuration

```env
PINATA_API_KEY=your-pinata-api-key
PINATA_SECRET_KEY=your-pinata-secret
IPFS_GATEWAY_URL=https://gateway.pinata.cloud/ipfs  # optional
```

## Failure Handling

If Pinata credentials are missing or the API call fails:
- Certificate is stored in local in-memory fallback
- A synthetic `local_<hash>` CID is returned
- `pinned: false` is set in the response
- A warning is logged — the donation proceeds normally

## Security Assumptions

- CID integrity: IPFS content addressing ensures the certificate cannot be tampered with
- No PII: certificates contain only public keys, amounts, and timestamps
- Fallback CIDs are prefixed `local_` to distinguish them from real IPFS CIDs
