# Stellar Testnet/Mainnet Environment Switching

## Overview
This feature introduces automatic pre-configuration for deploying nodes across the Stellar `testnet` and `mainnet` topologies simultaneously via a single deterministic environmental flag.

## Implementation Details

### Configuration Variables
To switch operational networks natively, set the environmental variable `STELLAR_ENVIRONMENT`:

```bash
STELLAR_ENVIRONMENT=testnet  # Operates completely natively accessing Horizon-Testnet.
# or
STELLAR_ENVIRONMENT=mainnet  # Transitions strictly onto real Public Global Network.
```

If left undefined, implementations fallback inherently securely to `testnet` deployments preventing erroneous fund drains.

### Automatic Parameters
Once defined natively:
- `network` natively maps securely resolving.
- `horizonUrl` is swapped reliably.
- `networkPassphrase` aligns strictly to target topologies.
- Standard operating `feeMultiplier` configs bind natively avoiding excess expenditures dynamically on Test instances.

Overrides explicitly provided (e.g. `$HORIZON_URL`) inside the local environmental space strictly prioritize locally over the pre-built `environments` object allowing custom sandbox configurations smoothly.

### Testing Context Protections
For absolute security: the application natively triggers an explicit error during `NODE_ENV=test` initialization periods if `STELLAR_ENVIRONMENT` indicates a `mainnet` state. This prevents localized test suites from executing physical mutations upon external ledgers natively.

### Integrations
You can inspect the active topologies through standard `/health` pings securely yielding:
```json
{
  "stellarEnvironment": "testnet",
  "stellarNetwork": "testnet",
  ...
}
```
