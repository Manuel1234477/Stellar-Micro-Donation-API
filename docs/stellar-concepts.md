# Stellar Concepts for New Contributors

You don't need deep blockchain knowledge to contribute to this project. This page covers the Stellar-specific concepts you'll encounter in the codebase.

## The Stellar Network

Stellar is a decentralized payment network designed for fast, low-cost transfers. Key facts:

- Transactions settle in **3–5 seconds**
- Fees are tiny: **0.00001 XLM** per operation (~fractions of a cent)
- Two environments: **testnet** (free, for development) and **mainnet** (real money)

In this project, `STELLAR_NETWORK=testnet` is the default. Set `MOCK_STELLAR=true` to skip the network entirely during development.

## XLM (Lumens)

XLM is Stellar's native currency. Every account must hold a minimum balance (currently **1 XLM**) to exist on the network. Donation amounts in this API are denominated in XLM.

## Accounts and Public Keys

A Stellar account is identified by a **public key** — a 56-character string starting with `G`:

```
GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H
```

In this codebase, `senderPublicKey` and `recipientPublicKey` in donation requests are Stellar public keys. The corresponding **secret key** (starts with `S`) is never stored by this API — it's used client-side to sign transactions.

## Horizon API

Horizon is Stellar's HTTP API server. This project uses it to:
- Submit payment transactions
- Look up account balances
- Fetch transaction history

The `HORIZON_URL` env var points to either the testnet (`https://horizon-testnet.stellar.org`) or mainnet (`https://horizon.stellar.org`) Horizon server.

In code, `StellarService` wraps all Horizon calls. `MockStellarService` replaces it in tests.

## Transactions and Operations

A Stellar **transaction** contains one or more **operations**. For donations, we use a single **Payment operation**:

```
Transaction
  └── Payment operation
        ├── source: sender's public key
        ├── destination: recipient's public key
        ├── asset: XLM (native)
        └── amount: "10.00"
```

Each submitted transaction gets a unique **transaction hash** (64-character hex string) that can be used to verify it on the blockchain.

## Memos

Transactions can include an optional **memo** — a short text field (up to 28 bytes) attached to the transaction on-chain. This project uses memos to tag donations with notes or reference IDs.

## Sequence Numbers

Every Stellar account has a **sequence number** that increments with each transaction. If you submit a transaction with the wrong sequence number, it fails with `tx_bad_seq`. The SDK handles this automatically, but you may see this error in tests that simulate failures.

## Testnet vs Mainnet

| | Testnet | Mainnet |
|--|---------|---------|
| Real money | No | Yes |
| Friendbot (free XLM) | Yes | No |
| Horizon URL | `horizon-testnet.stellar.org` | `horizon.stellar.org` |
| Use for | Development, testing | Production |

To get free testnet XLM: `https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY`

## MockStellarService

For local development and all automated tests, set `MOCK_STELLAR=true`. This activates `MockStellarService`, which:
- Returns fake but structurally valid responses
- Never makes network calls
- Supports simulated failures via `SIMULATE_FAILURE` env var

See [Mock Stellar Guide](./guides/MOCK_STELLAR_GUIDE.md) for details.
