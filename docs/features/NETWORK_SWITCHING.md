# Stellar Network Switching Guide

## Quick Start

Switch between Stellar networks by editing the `STELLAR_NETWORK` variable in `src/.env`:

```env
STELLAR_NETWORK=testnet
```

**No code changes required** - just update the environment variable and restart your server.

## Supported Networks

### Testnet (Default)
```env
STELLAR_NETWORK=testnet
```
- Best for development and testing
- Free test XLM available from friendbot
- No real money involved

### Mainnet (Production)
```env
STELLAR_NETWORK=mainnet
```
- Live Stellar network
- Real XLM transactions
- Use only when ready for production

### Futurenet (Experimental)
```env
STELLAR_NETWORK=futurenet
```
- Testing upcoming Stellar features
- Experimental network

## Custom Horizon URL

If you need to use a custom Horizon server, uncomment and set:

```env
HORIZON_URL=https://your-custom-horizon-url.com
```

This overrides the preset URL for the selected network.

## Network Presets

The configuration automatically uses these Horizon URLs:

| Network    | Horizon URL                              |
|------------|------------------------------------------|
| testnet    | https://horizon-testnet.stellar.org      |
| mainnet    | https://horizon.stellar.org              |
| futurenet  | https://horizon-futurenet.stellar.org    |

## Verification

When you start the server, check the console output:

```
[Stellar Config] Using REAL Stellar service on TESTNET
[Stellar Config] Horizon URL: https://horizon-testnet.stellar.org
```

This confirms which network you're connected to.

## Mock Mode

For testing without any network calls:

```env
MOCK_STELLAR=true
```

This uses the mock Stellar service regardless of network configuration.
