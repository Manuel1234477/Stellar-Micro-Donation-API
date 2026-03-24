# Stellar Environment Switching

## Overview

We have introduced a simplified and secure environment switching mechanism for Stellar configurations. You can now use a single `STELLAR_ENVIRONMENT` variable to configure networks (testnet/mainnet). This mechanism automatically resolves to the correct Horizon URL, network passphrase, and fee settings.

## Configuration

To set up the API for a specific Stellar network, set the `STELLAR_ENVIRONMENT` variable in your `.env` file or environment.

### Supported Environments
- `testnet` (default)
- `mainnet`

### Examples
**Testnet Setup:**
```shell
STELLAR_ENVIRONMENT=testnet
# Automatically uses Test SDF Network passphrase and horizon-testnet URL.
```

**Mainnet Setup:**
```shell
STELLAR_ENVIRONMENT=mainnet
# Automatically uses Public Global Stellar Network passphrase and horizon mainnet URL.
```

If you need a custom Horizon URL, you can still override it manually by setting `HORIZON_URL` in your environment.

## Security Features

To prevent accidental mainnet operations during testing:
- **Strict Network Fencing:** If `NODE_ENV=test` and `STELLAR_ENVIRONMENT=mainnet`, the application configuration will intentionally throw a `ConfigurationError` and the application will fail to start.

## Health Checks

The health check endpoint (`/health` and `/health/ready`) includes the current configured Stellar environment and Horizon URL to help operators verify that the API is connected to the right network.

```json
{
  "status": "healthy",
  "dependencies": {
    "stellar": {
      "status": "healthy",
      "network": "testnet",
      "environment": "testnet",
      "horizonUrl": "https://horizon-testnet.stellar.org"
    }
  }
}
```

## Internal Architecture

- `src/config/stellarEnvironments.js`: Contains hardcoded configuration presets for testnet and mainnet.
- `src/config/index.js`: Responsible for parsing `STELLAR_ENVIRONMENT` and assembling the application configuration. Employs the security validation that blocks mainnet use during test.
- `src/services/StellarService.js`: Initializes connection to Stellar Horizon using the configuration object and its preset settings. Avoids inline conditionals scattered throughout the file.
