# Debug Mode for Local Development

## Overview

Debug mode provides increased log verbosity and additional diagnostics for local development and troubleshooting. It is disabled by default and should **never be enabled in production**.

## Configuration

### Enable Debug Mode

Add to your `.env` file:

```env
DEBUG_MODE=true
```

### Disable Debug Mode (Default)

```env
DEBUG_MODE=false
```

Or simply omit the variable entirely.

## What Debug Mode Does

When enabled, debug mode:

1. **Adds DEBUG-level logs** throughout the application
2. **Exposes additional diagnostics** including:
   - Configuration details on startup
   - Request headers, query params, and IP addresses
   - Database lookup results
   - Stellar transaction initiation and completion
   - Network configuration details

3. **Maintains security** by still sanitizing sensitive fields

## Debug Log Examples

### Server Startup
```
[2026-02-24T23:56:50.272Z] [DEBUG] [APP] Debug mode enabled - verbose logging active
[2026-02-24T23:56:50.273Z] [DEBUG] [APP] Configuration loaded {"port":3000,"network":"testnet","horizonUrl":"https://horizon-testnet.stellar.org","mockStellar":true,"nodeEnv":"development"}
```

### Request Processing
```
[2026-02-24T23:56:51.123Z] [DEBUG] [REQUEST_LOGGER] Request details {"headers":{"content-type":"application/json"},"query":{},"params":{},"ip":"127.0.0.1"}
[2026-02-24T23:56:51.145Z] [DEBUG] [DONATION_ROUTE] Processing donation request {"senderId":1,"receiverId":2,"amount":"10.5","hasMemo":true}
[2026-02-24T23:56:51.156Z] [DEBUG] [DONATION_ROUTE] Database lookup complete {"senderFound":true,"receiverFound":true}
[2026-02-24T23:56:51.167Z] [DEBUG] [DONATION_ROUTE] Initiating Stellar transaction
[2026-02-24T23:56:51.234Z] [DEBUG] [DONATION_ROUTE] Stellar transaction successful {"hash":"abc123..."}
```

### Stellar Configuration
```
[2026-02-24T23:56:50.100Z] [DEBUG] [STELLAR_CONFIG] Using custom Horizon URL {"network":"testnet","horizonUrl":"https://custom-horizon.example.com"}
```

## Usage in Code

### Adding Debug Logs

```javascript
const log = require('../utils/log');

// Debug log with metadata
log.debug('MY_SCOPE', 'Operation details', {
  userId: 123,
  action: 'create',
  timestamp: Date.now()
});

// Check if debug mode is enabled
if (log.isDebugMode) {
  // Perform expensive debug operations only when needed
  const debugInfo = gatherDetailedDiagnostics();
  log.debug('MY_SCOPE', 'Detailed diagnostics', debugInfo);
}
```

### Available Log Levels

```javascript
log.info('SCOPE', 'Message', metadata);   // Always logged
log.warn('SCOPE', 'Message', metadata);   // Always logged
log.error('SCOPE', 'Message', metadata);  // Always logged
log.debug('SCOPE', 'Message', metadata);  // Only when DEBUG_MODE=true
```

## Production Safety

### ⚠️ Important Warnings

1. **Never enable in production** - Debug logs may expose sensitive information
2. **Performance impact** - Debug logging adds overhead
3. **Log volume** - Debug mode significantly increases log output

### Validation

The environment validator ensures `DEBUG_MODE` is a valid boolean string:

```bash
# Valid values
DEBUG_MODE=true
DEBUG_MODE=false

# Invalid values (will fail validation)
DEBUG_MODE=yes
DEBUG_MODE=1
DEBUG_MODE=enabled
```

## Testing

Run debug mode tests:

```bash
npm test tests/debug-mode.test.js
```

## Comparison with LOG_VERBOSE

| Feature | DEBUG_MODE | LOG_VERBOSE |
|---------|-----------|-------------|
| Purpose | Development diagnostics | Request/response logging |
| Scope | Application-wide | Request logger only |
| Output | DEBUG-level logs | Request/response bodies |
| Use Case | Troubleshooting | API debugging |

Both can be enabled simultaneously for maximum visibility during development.

## Quick Reference

```bash
# Enable debug mode for development
echo "DEBUG_MODE=true" >> .env

# Start server with debug logging
npm start

# Disable debug mode
echo "DEBUG_MODE=false" >> .env
# or remove the line entirely
```

## Related Documentation

- [Logging Feature](LOGGING_FEATURE.md)
- [Environment Configuration](.env.example)
- [Development Guide](guides/QUICK_START.md)
