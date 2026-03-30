# Payment Channels

This feature adds support for Stellar payment channels to enable high-frequency micro-donations with bulk on-chain settlement.

## Overview

Payment channels allow two parties to exchange signed off-chain state updates and settle the final balance on-chain later. This reduces on-chain transaction volume and makes per-second micro-donations practical.

## Endpoints

- `POST /channels/open`
  - Opens a new payment channel.
  - Request body: `{ senderKey, receiverKey, capacity, sourceSecret?, fundingTxId?, metadata? }`
  - If `sourceSecret` is provided, the backend will fund an escrow account on-chain using `StellarService.openChannel()` and persist the escrow metadata.

- `POST /channels/:id/update`
  - Applies an off-chain balance update to an open channel.
  - Request body: `{ amount, senderSecret, receiverSecret, senderSig, receiverSig }`
  - Updates sequence and balance without submitting a Stellar transaction.

- `POST /channels/:id/close`
  - Settles the final agreed channel balance on-chain.
  - Request body: `{ senderSecret }`
  - If the channel was opened with escrow metadata, `StellarService.closeChannel()` is used to submit the settlement transaction.
  - Closing an already-closed or already-settled channel returns `409 Conflict`.

- `GET /channels`
  - Lists open channels by default.
  - Optional query parameter: `?status=open|settled|disputed|closed`

## Service behavior

- `StellarService.openChannel(sourceSecret, recipientPublicKey, depositAmount)`
  - Creates and funds an escrow account, then returns escrow keys and transaction metadata.

- `StellarService.updateChannel(channelId, newAmount)`
  - Simulates off-chain channel state updates for mock environments.

- `StellarService.closeChannel(channelId, escrowSecret, recipientPublicKey, amount)`
  - Submits the final settlement transaction from the escrow account.

## Mock behavior

`MockStellarService` includes simulated channel methods for:

- `openChannel(sourceSecret, recipientPublicKey, depositAmount)`
- `updateChannel(channelId, newAmount)`
- `closeChannel(channelId, escrowSecret, recipientPublicKey, amount)`

These methods let tests cover the full channel lifecycle without live Horizon connectivity.
