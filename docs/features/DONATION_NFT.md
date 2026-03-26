# Donation Certificate NFT (Issue #426)

Donors can receive a unique Stellar NFT as a donation certificate when `mintCertificate: true` is passed on donation creation.

## Minting Flow

1. Caller sends `POST /donations` with `mintCertificate: true`.
2. The donation record is created as normal.
3. After the donation is persisted, the API attempts to mint a certificate NFT:
   - Asset code: `CERT` + first 8 alphanumeric chars of the donation ID (uppercase), max 12 chars total.
   - A single Stellar transaction issues exactly **1 unit** of the asset to the recipient, then sets the issuer's master weight to **0**, permanently locking the supply at 1.
4. On success, the transaction record is updated with `nft_asset_code`, `nft_issuer`, `nft_tx_hash`, `nft_minted_at`.
5. On failure, the error is logged and stored in `nft_mint_error`. **The donation itself always succeeds.**

## Environment Variables

| Variable | Description |
|---|---|
| `NFT_ISSUER_SECRET` | Stellar secret key used as the NFT issuer. Falls back to `STELLAR_SECRET` / `SERVICE_SECRET_KEY`. |

Each NFT requires a **fresh issuer account** funded with enough XLM to cover the transaction fee and base reserve. The issuer is locked after minting, so it cannot be reused.

## Endpoints

### POST /donations

Create a donation and optionally mint a certificate NFT.

**Body (additional field):**

```json
{
  "amount": "10",
  "recipient": "GABC...",
  "mintCertificate": true
}
```

**Response (NFT minted):**

```json
{
  "success": true,
  "data": {
    "transactionHash": "...",
    "nftMinted": true,
    "nftAssetCode": "CERT1A2B3C4D",
    "nftIssuer": "GISSUER...",
    "nftTxHash": "abc123..."
  }
}
```

**Response (NFT failed — donation still succeeds):**

```json
{
  "success": true,
  "data": {
    "transactionHash": "...",
    "nftMinted": false,
    "nftError": "Horizon connection refused"
  }
}
```

### GET /donations/:id/certificate

Retrieve the NFT certificate details for a donation.

**Response:**

```json
{
  "success": true,
  "data": {
    "donationId": "1234-abcd",
    "nftAssetCode": "CERT1A2B3C4D",
    "nftIssuer": "GISSUER...",
    "nftTxHash": "abc123...",
    "nftMintedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

Returns `404` if the donation does not exist or has no minted certificate.

### GET /wallets/:id/certificates

List all donation certificate NFTs held by a wallet.

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "assetCode": "CERT1A2B3C4D",
      "issuer": "GISSUER...",
      "balance": "1.0000000"
    }
  ],
  "count": 1
}
```

## Security Assumptions

- **Supply = 1 enforced on-chain.** After minting, the issuer's master weight is set to 0. No further operations can be signed by the issuer, making additional issuance impossible.
- **Issuer secret is server-side only.** The `NFT_ISSUER_SECRET` must be kept confidential. Each certificate should ideally use a dedicated fresh keypair to prevent any cross-certificate correlation.
- **Minting failure is non-blocking.** A network error, misconfiguration, or Horizon outage will never prevent a donation from being recorded. The error is stored in `nft_mint_error` for later inspection.
- **Asset code is deterministic.** The code is derived from the donation ID, making it auditable and reproducible.
