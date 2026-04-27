# Configurable Request Logging

## Overview

The configurable request logging middleware provides per-path configurable logging with sampling, body logging, and sensitive field sanitization. This allows production deployments to suppress health check noise, sample high-volume endpoints, and log full request/response bodies for debugging specific endpoints.

## Features

- **Path-based filtering**: Skip logging for health check and metrics endpoints
- **Request/response body logging**: Enable body logging only for specific paths
- **Sampling**: Reduce log volume for high-traffic endpoints with configurable sampling rates
- **Per-path sampling**: Different sampling rates for different endpoint patterns
- **Sensitive field sanitization**: Automatically redact passwords, secrets, and other sensitive data
- **Environment-based configuration**: Configure via environment variables

## Configuration

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `LOG_SKIP_PATHS` | Comma-separated list of paths to exclude from logging | (none) | `/health,/metrics,/api/health` |
| `LOG_BODY_PATHS` | Comma-separated list of paths where bodies should be logged | (none) | `/api/donations,/api/wallets` |
| `LOG_SAMPLE_RATE` | Global sampling rate (0.0 - 1.0) | `1.0` | `0.1` (10% of requests) |
| `LOG_BODY` | Enable body logging for all paths | `false` | `true` |
| `LOG_HEADERS` | Include headers in logs | `false` | `true` |

### Programmatic Configuration

```javascript
const { ConfigurableRequestLogger } = require('./middleware/requestLogger');

const logger = new ConfigurableRequestLogger({
  skipPaths: ['/health', '/metrics'],
  bodyPaths: ['/api/donations'],
  sampleRate: 0.5, // Sample 50% of requests
  pathSampling: {
    '/api/health': 0.1, // Sample 10% of health checks
    '/api/metrics': 0.05 // Sample 5% of metrics
  },
  sensitiveFields: ['customSecret'], // Additional sensitive fields
  logBodies: false, // Only log bodies for bodyPaths
  logToFile: true, // Write logs to file
  logHeaders: false // Don't include headers by default
});
```

## Usage

### Basic Usage

```javascript
const requestLogger = require('./middleware/requestLogger');

// Add to Express app
app.use(requestLogger.middleware());
```

### With Custom Configuration

```javascript
const { ConfigurableRequestLogger } = require('./middleware/requestLogger');

const logger = new ConfigurableRequestLogger({
  skipPaths: ['/health', '/metrics'],
  bodyPaths: ['/api/donations'],
  sampleRate: 0.1
});

app.use(logger.middleware());
```

## Path Pattern Matching

The middleware supports several pattern types:

- **Exact match**: `/health` matches only `/health`
- **Wildcard prefix**: `/api/*` matches `/api/users`, `/api/donations`, etc.
- **Case-insensitive**: `/Health` matches `/health`

## Sampling

Sampling reduces log volume by only logging a percentage of requests. The sampling is deterministic based on the request path, ensuring consistent behavior for the same endpoint.

```javascript
// Sample 10% of requests globally
const logger = new ConfigurableRequestLogger({
  sampleRate: 0.1
});

// Different rates per path
const logger = new ConfigurableRequestLogger({
  sampleRate: 1.0, // Log all requests by default
  pathSampling: {
    '/api/health': 0.1, // Sample 10% of health checks
    '/api/metrics': 0.05 // Sample 5% of metrics
  }
});
```

## Sensitive Field Sanitization

The middleware automatically redacts sensitive fields from logs:

- `password`
- `secret`, `secretKey`, `secret_key`
- `privateKey`, `private_key`
- `token`
- `authorization`
- `apiKey`, `api_key`, `api-key`
- `creditCard`, `credit_card`
- `ssn`, `social_security`
- `encryptionKey`, `encryption_key`

Custom sensitive fields can be added:

```javascript
const logger = new ConfigurableRequestLogger({
  sensitiveFields: ['customSecret', 'internalToken']
});
```

## Log Format

### Console Output

```
INFO [REQUEST_LOGGER] POST /api/donations 201 - 145ms
INFO [REQUEST_LOGGER] Request payload { requestId: 'abc-123', body: { ... } }
INFO [REQUEST_LOGGER] Response payload { requestId: 'abc-123', body: { ... } }
```

### File Output

Logs are written to `logs/api-YYYY-MM-DD.log` in JSON format:

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "requestId": "abc-123",
  "method": "POST",
  "endpoint": "/api/donations",
  "statusCode": 201,
  "duration": 145,
  "samplingRate": 1.0,
  "request": {
    "body": { "amount": 100, "password": "[REDACTED]" },
    "ip": "127.0.0.1"
  },
  "response": {
    "statusCode": 201,
    "body": { "id": 1, "status": "success" }
  }
}
```

## Security Considerations

1. **Sensitive data never logged**: All sensitive fields are automatically redacted
2. **Sampling bias**: Deterministic sampling ensures consistent behavior
3. **Path-based control**: Fine-grained control over what gets logged
4. **No PII in logs**: User identifiers and personal information are not logged by default

## Performance Impact

- **Minimal overhead**: Middleware only processes requests that will be logged
- **Sampling reduces volume**: High-traffic endpoints can be sampled to reduce log I/O
- **Async file writes**: File logging uses async operations to avoid blocking

## Testing

Run tests with:

```bash
npm test tests/request-logger.test.js
```

Tests verify:
- Health check and metrics endpoints can be excluded from logs
- Request/response bodies are logged only for configured paths
- Sensitive fields are never logged
- Sampling reduces log volume

## Examples

### Production Configuration

```javascript
// Skip health checks, sample high-traffic endpoints
const logger = new ConfigurableRequestLogger({
  skipPaths: ['/health', '/metrics', '/api/health'],
  sampleRate: 0.1, // Sample 10% globally
  pathSampling: {
    '/api/donations': 0.05, // Sample 5% of donations
    '/api/wallets': 0.2 // Sample 20% of wallet ops
  },
  logToFile: true,
  logHeaders: false
});
```

### Development Configuration

```javascript
// Log everything, include bodies for debugging
const logger = new ConfigurableRequestLogger({
  skipPaths: [],
  logBodies: true,
  logHeaders: true,
  sampleRate: 1.0
});
```

### Debugging Specific Endpoint

```javascript
// Log full details for specific endpoint
const logger = new ConfigurableRequestLogger({
  bodyPaths: ['/api/donations/create'],
  logBodies: true,
  logHeaders: true,
  sampleRate: 1.0
});
```
