# HTTP/2 Server Push for Related Resources

When a client fetches a donation, the API proactively hints at (or pushes) the related wallet and transaction resources to reduce round-trip latency.

## How It Works

On `GET /donations/:id` the server:

1. Appends a `Link` header listing related resources (works on HTTP/1.1 and HTTP/2).
2. Initiates HTTP/2 server push streams when the connection supports it.

```
Link: </wallets/1>; rel=preload; as=fetch,
      </wallets/2>; rel=preload; as=fetch,
      </transactions?donationId=7>; rel=preload; as=fetch
```

## Enabling

```env
ENABLE_SERVER_PUSH=true   # default: false (off)
```

## Opting Out

Send `X-No-Push: 1` on any request to suppress both the `Link` header and push streams:

```bash
curl -I -H "X-No-Push: 1" http://localhost:3000/donations/7
```

Without the header (push enabled):

```bash
curl -I http://localhost:3000/donations/7
# HTTP/1.1 200 OK
# Link: </wallets/1>; rel=preload; as=fetch, ...
```

## Security

Pushed streams forward the original `Authorization` header — pushed resources are subject to the same auth checks as the primary request. No private data is pushed to unauthenticated callers.

## Graceful Degradation

The push logic is a no-op on HTTP/1.1 connections. The `Link` header is still set, allowing clients and CDNs to act on it as an early hint.

## Related Resources

| Relationship | URL pattern |
|---|---|
| Donor wallet | `/wallets/:senderId` |
| Recipient wallet | `/wallets/:receiverId` |
| Transactions | `/transactions?donationId=:id` |
