# Stellar Glossary for New Contributors

Welcome! This glossary explains the key Stellar concepts you'll encounter while working on this project. Don't worry if you're new to blockchain or Stellar—we've kept things simple and practical.

## Core Concepts

### Stellar Network
The Stellar network is a decentralized payment platform designed for fast, low-cost cross-border transactions. Think of it as a global payment highway that connects different currencies and financial systems.

**Key features:**
- Fast transactions (typically 3-5 seconds)
- Low transaction costs (fractions of a cent)
- Built for moving money across borders
- Open-source and decentralized

### XLM (Lumens)
XLM, also called Lumens, is the native cryptocurrency of the Stellar network. It serves two main purposes:

1. **Transaction fees**: Every transaction on Stellar requires a tiny amount of XLM (usually 0.00001 XLM)
2. **Anti-spam protection**: The small fee prevents malicious actors from flooding the network
3. **Bridge currency**: XLM can act as an intermediary when converting between different currencies

**Fun fact:** 1 XLM can be divided into 10 million smaller units called "stroops" (1 stroop = 0.0000001 XLM).

**In this project:** When users make donations, they're sending XLM from their wallet to a recipient's wallet.

### Account
A Stellar account is identified by a public key (a long string starting with 'G'). Every account needs a minimum balance of 1 XLM to remain active on the network.

**Example account address:**
```
GCDNJUBQSX7AJWLJACMJ7I4BC3Z47BQUTMHEICZLE6MU4KQBRYG5JY6B
```

### Wallet
A wallet is software that manages your Stellar accounts and private keys. It allows you to:
- Send and receive XLM
- View your balance
- Sign transactions

**In this project:** Users connect their wallets to make donations.

## Transaction Components

### Memo
A memo is an optional message attached to a Stellar transaction. It's like adding a note to a payment.

**Common uses:**
- **Exchange deposits**: When sending to an exchange, the memo identifies your account (e.g., "User ID: 12345")
- **Payment references**: Adding invoice numbers or donation messages
- **Recipient identification**: Helping shared addresses route payments correctly

**Types of memos:**
- `MEMO_TEXT`: Plain text (up to 28 characters)
- `MEMO_ID`: A number (useful for user IDs)
- `MEMO_HASH`: A 32-byte hash
- `MEMO_RETURN`: Used for refunds

**Important:** Always include the memo when required by exchanges or services, or your funds might not be credited properly!

**In this project:** Memos can be used to attach messages to donations or identify the purpose of a payment.

### Transaction
A transaction is a bundle of operations submitted to the Stellar network. Each transaction:
- Has a source account
- Contains one or more operations (like payments)
- Requires a small XLM fee
- Can include a memo
- Must be signed with the account's private key

**Example transaction flow:**
1. Create transaction with payment operation
2. Add memo (optional)
3. Sign with private key
4. Submit to network
5. Network validates and processes (3-5 seconds)

## API and Tools

### Horizon API
Horizon is the HTTP API server that lets applications interact with the Stellar network. Instead of dealing with low-level blockchain data, Horizon provides a friendly REST API.

**What Horizon does:**
- Provides account information (balances, transaction history)
- Submits transactions to the network
- Streams real-time updates
- Queries ledger data
- Makes blockchain data easy to consume

**Think of it as:** A translator between your application and the Stellar blockchain.

**Horizon endpoints you'll use:**
- `/accounts/{account_id}` - Get account details
- `/transactions` - Submit or query transactions
- `/payments` - View payment history
- `/operations` - See all operations

**In this project:** Our API uses Horizon to interact with Stellar, check balances, and submit donation transactions.

**Official Horizon instances:**
- Testnet: `https://horizon-testnet.stellar.org`
- Mainnet: `https://horizon.stellar.org`

### Stellar SDK
The Stellar SDK is a library (available in JavaScript, Python, Go, etc.) that simplifies working with Stellar. It handles:
- Building transactions
- Signing with keypairs
- Communicating with Horizon
- Parsing responses

**In this project:** We use the JavaScript SDK (`@stellar/stellar-sdk`) to build and submit transactions.

## Network Types

### Testnet
A test version of Stellar where you can experiment without using real money. Perfect for development!

**Features:**
- Free test XLM from friendbot
- Same functionality as mainnet
- Safe for testing and learning

**In this project:** We develop and test using Stellar's testnet before going live.

### Mainnet
The live Stellar network where real transactions happen with real XLM.

## Common Terms

### Keypair
A pair of cryptographic keys:
- **Public key**: Your account address (safe to share)
- **Secret key**: Used to sign transactions (keep this secret!)

### Operation
A single action within a transaction, such as:
- Payment
- Create account
- Change trust
- Manage data

### Ledger
A snapshot of the entire Stellar network state at a specific point in time. New ledgers are created every 3-5 seconds.

### Stroop
The smallest unit of XLM (0.0000001 XLM). Named after Stroopy, the Stellar mascot!

## Quick Reference

| Term | Simple Explanation |
|------|-------------------|
| XLM | Stellar's cryptocurrency (like Bitcoin for Stellar) |
| Memo | A note attached to a payment |
| Horizon | The API for talking to Stellar |
| Account | Your address on Stellar (starts with 'G') |
| Testnet | Practice version of Stellar (free to use) |
| Mainnet | Real Stellar network (real money) |
| Keypair | Your public address + secret key |
| Stroop | Tiny fraction of XLM (0.0000001) |

## Learning Resources

Want to dive deeper? Check out:
- [Stellar Developer Docs](https://developers.stellar.org)
- [Stellar Laboratory](https://laboratory.stellar.org) - Interactive tool for building transactions
- [Stellar Quest](https://quest.stellar.org) - Learn by doing challenges

## Need Help?

If you encounter unfamiliar terms while contributing:
1. Check this glossary first
2. Search the [Stellar documentation](https://developers.stellar.org)
3. Ask in our project discussions
4. Visit the [Stellar Stack Exchange](https://stellar.stackexchange.com)

---

*Content was rephrased for compliance with licensing restrictions. Sources: [Stellar Developer Documentation](https://developers.stellar.org), [Stellar API Reference](https://stellar.org/developers/reference/)*
