# Migration Guide: Removing `sourceSecret` from API Request Bodies

**Issue:** #705  
**Severity:** SECURITY — BREAKING CHANGE  
**Affected versions:** All versions prior to this fix

---

## Why This Change Was Made

Sending a Stellar private key (`sourceSecret`) in an HTTP request body is a severe security anti-pattern:

- The server holds private keys in memory, logs, and potentially in error reports or crash dumps.
- Any server compromise exposes all users' Stellar private keys.
- Keys transmitted over the network exist in server memory even when TLS is used.
- This pattern is incompatible with hardware wallets and secure key management systems.

**The server should never receive or handle users' private keys.** All transaction signing must happen client-side.

---

## Affected Endpoints

| Endpoint | Old field | New field |
|---|---|---|
| `POST /offers` | `sourceSecret` | `signedXDR` |
| `DELETE /offers/:id` | `sourceSecret` | `signedXDR` |
| `POST /donations/claimable` | `sourceSecret` | `signedXDR` |
| `POST /donations/claimable/:id/claim` | `claimantSecret` | `signedXDR` |
| `POST /donations/cross-asset` | `sourceSecret` | `signedXDR` |
| `PATCH /wallets/:id/inflation-destination` | `sourceSecret` | `signedXDR` |
| `PUT /wallets/:id/inflation-destination` | `sourceSecret` | `signedXDR` |

---

## New Client-Side Signing Workflow

Instead of sending your secret key to the server, you now:

1. **Fetch the transaction parameters** from the server (or construct them locally).
2. **Build the transaction** client-side using the Stellar SDK.
3. **Sign the transaction** with your secret key — locally, never leaving your device.
4. **Submit the signed XDR** to the API.

### JavaScript Example (using `stellar-sdk`)

```js
const StellarSdk = require('stellar-sdk');

const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
const networkPassphrase = StellarSdk.Networks.TESTNET;

// 1. Load the source account to get the current sequence number
const sourceKeypair = StellarSdk.Keypair.fromSecret('SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');
const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

// 2. Build the transaction (example: manage sell offer)
const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
  fee: await server.fetchBaseFee(),
  networkPassphrase,
})
  .addOperation(StellarSdk.Operation.manageSellOffer({
    selling: StellarSdk.Asset.native(),
    buying: new StellarSdk.Asset('USDC', 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'),
    amount: '100',
    price: '0.5',
    offerId: 0,
  }))
  .setTimeout(30)
  .build();

// 3. Sign locally — the secret key never leaves this client
transaction.sign(sourceKeypair);

// 4. Get the signed XDR envelope
const signedXDR = transaction.toEnvelope().toXDR('base64');

// 5. Submit to the API
const response = await fetch('https://your-api/offers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': 'your-api-key' },
  body: JSON.stringify({
    signedXDR,
    sellingAsset: 'XLM',
    buyingAsset: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
    amount: '100',
    price: '0.5',
  }),
});
```

### Python Example (using `stellar-sdk`)

```python
from stellar_sdk import Keypair, Network, Server, TransactionBuilder, Asset, Operation
import requests, base64

server = Server("https://horizon-testnet.stellar.org")
keypair = Keypair.from_secret("SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX")

# Load account
account = server.load_account(keypair.public_key)

# Build and sign transaction
transaction = (
    TransactionBuilder(
        source_account=account,
        network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
        base_fee=100,
    )
    .append_manage_sell_offer_op(
        selling=Asset.native(),
        buying=Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),
        amount="100",
        price="0.5",
        offer_id=0,
    )
    .set_timeout(30)
    .build()
)
transaction.sign(keypair)
signed_xdr = transaction.to_xdr()

# Submit to API
resp = requests.post(
    "https://your-api/offers",
    json={
        "signedXDR": signed_xdr,
        "sellingAsset": "XLM",
        "buyingAsset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
        "amount": "100",
        "price": "0.5",
    },
    headers={"X-API-Key": "your-api-key"},
)
```

---

## Endpoint-Specific Notes

### `POST /donations/claimable`

Build a `createClaimableBalance` operation client-side, sign it, and submit the XDR. The `claimants` and `amount` fields are still required in the request body for server-side record-keeping.

### `POST /donations/claimable/:id/claim`

Build a `claimClaimableBalance` operation with the balance ID, sign it with the claimant's keypair, and submit the XDR.

### `POST /donations/cross-asset`

Use `GET /donations/cross-asset/paths` to discover available DEX paths first, then build a `pathPaymentStrictSend` or `pathPaymentStrictReceive` operation, sign it, and submit the XDR.

### `PUT /wallets/:id/inflation-destination`

Build a `setOptions` operation with `inflationDest` set, sign it, and submit the XDR along with `destinationPublicKey` for validation.

---

## Security Best Practices

- **Never log or store secret keys** — not in files, environment variables accessible to the server, or request bodies.
- **Use hardware wallets** where possible — the new XDR-based flow is fully compatible.
- **Validate XDR on the client** before submitting to catch construction errors early.
- **Set transaction timeouts** (`setTimeout(30)`) to prevent replay attacks with stale transactions.
