# End-to-End Test Suite with Real Stellar Testnet

## Overview

This document describes the design and operational procedures for running the real Stellar Testnet End-to-End (E2E) test suite. Unlike unit or mock-based integration tests, this suite interacts directly with Horizon Testnet and Friendbot to validate real on-chain transaction submission, payment processing, wallet creation, and donation verification.

## Running the E2E Suite Locally

To run the complete E2E testnet suite locally, execute:

```bash
npm run test:e2e
```

This runs Jest using `jest.config.e2e.js`, which executes tests serially with `maxWorkers: 1` to prevent hitting Friendbot rate limits.

## Required Environment Variables

The E2E suite requires the following environment variables to be configured:

- `MOCK_STELLAR=false`: Disables mock services and routes transactions to live Horizon testnet.
- `ENCRYPTION_KEY`: 32-byte secret key used for encrypting and decrypting wallet credentials and seeds.
- `STELLAR_NETWORK=TESTNET`: Configures SDK network passphrases to Stellar Testnet.
- `HORIZON_URL=https://horizon-testnet.stellar.org`: Horizon endpoint for testnet queries and submissions.
- `FRIENDBOT_URL=https://friendbot.stellar.org`: Friendbot endpoint for funding test accounts.

## Account Funding via Friendbot

During the global setup phase (`tests/e2e/setup.js`), master sponsor keypairs are generated and funded via Friendbot:

1. A new cryptographic keypair is created via `StellarSdk.Keypair.random()`.
2. The public address is submitted to `https://friendbot.stellar.org/?addr=<PUBLIC_KEY>`.
3. Balance confirmation is polled using Horizon API until native XLM is available.

## Retry and Backoff Logic

Network operations against public testnets are inherently subject to latency spikes, ledger close delays, and rate limiting. The test suite includes resilient retry logic located at `tests/e2e/helpers/retry.js`:

- **Exponential Backoff**: Calculates delay using $delay = \min(base \times 2^{attempt}, maxDelay) \times (1 + jitter)$.
- **Retry Invariant**: Automatically retries on 429 (Rate Limited), 503 (Service Unavailable), and transient connection timeouts up to 5 attempts before marking a test failed.
- **Polling Utility**: Uses `waitUntil()` to poll for asynchronous ledger state transitions.
