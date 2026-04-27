# API Gateway Integration Support

This document describes how to configure API Gateway integration support for the Stellar Micro-Donation API, enabling proper handling of proxied requests from AWS API Gateway, Kong, Nginx, and other reverse proxies.

## Overview

The API now supports API Gateway integration by:

- Configuring Express `trust proxy` settings to correctly handle `X-Forwarded-For` and `X-Forwarded-Proto` headers
- Implementing request correlation with `X-Request-ID` headers
- Detecting HTTPS protocols for secure cookie/session policies
- Supporting comma-separated lists of trusted proxy IPs and CIDR blocks

## Configuration

### Environment Variables

Set the `TRUSTED_PROXIES` environment variable to configure which proxies the application should trust:

```bash
# Single proxy
TRUSTED_PROXIES=10.0.0.1

# Multiple proxies (comma-separated)
TRUSTED_PROXIES=10.0.0.1, 192.168.1.0/24, 203.0.113.0/24

# Default (if not set): loopback
# TRUSTED_PROXIES not set = trusts localhost/loopback
```

### Supported Formats

The `TRUSTED_PROXIES` variable supports:
- Individual IP addresses: `192.168.1.1`
- CIDR blocks: `192.168.1.0/24`
- Special values: `loopback`, `linklocal`, `uniquelocal`
- Comma-separated combinations: `10.0.0.1, 192.168.0.0/16, loopback`

## Gateway-Specific Configuration

### AWS API Gateway

For AWS API Gateway deployments:

```bash
# Trust AWS API Gateway IPs (example ranges - verify current ranges)
TRUSTED_PROXIES=10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
```

**Important**: AWS API Gateway IP ranges can change. Refer to the [AWS IP Ranges documentation](https://docs.aws.amazon.com/general/latest/gr/aws-ip-ranges.html) and filter for `API_GATEWAY` service.

Configure your API Gateway to forward headers:
- `X-Forwarded-For`: Client IP address
- `X-Forwarded-Proto`: Protocol (http/https)
- `X-Request-ID`: Request ID (optional, will be generated if missing)

### Kong API Gateway

For Kong deployments:

```bash
# Trust Kong proxy IPs
TRUSTED_PROXIES=10.0.0.0/8, 172.16.0.0/12
```

Kong typically runs in the same network as your application. Configure Kong to preserve and forward the necessary headers.

### Nginx Reverse Proxy

For Nginx configurations:

```bash
# Trust Nginx proxy IP
TRUSTED_PROXIES=127.0.0.1
```

Example Nginx configuration:

```nginx
server {
    listen 80;
    server_name your-api.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
        proxy_set_header Host $host;
    }
}
```

If Nginx is on a different server:

```bash
TRUSTED_PROXIES=nginx-server-ip
```

## Request Correlation

The API automatically handles request correlation:

- **Incoming**: Reads `X-Request-ID` from request headers
- **Generation**: Creates UUID v4 if header is missing
- **Propagation**: Sets `X-Request-ID` in response headers
- **Context**: Attaches `req.id` for use in logging and downstream services

## Security Considerations

- Only trust proxies that are under your control
- Regularly audit and update trusted proxy IP ranges
- Use HTTPS between proxies and the application
- Monitor for header spoofing attempts

## Health Check Endpoint

The `/health` endpoint now includes proxy information for debugging:

```json
{
  "status": "healthy",
  "clientIp": "192.168.1.100",
  "protocol": "https",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "dependencies": {...}
}
```

## Testing

Run the integration tests to verify configuration:

```bash
npm test -- implement-api-gateway-integration-support.test.js
```

The tests mock headers and verify:
- Client IP detection from `X-Forwarded-For`
- Protocol detection from `X-Forwarded-Proto`
- Request ID generation and propagation
- Integration with mock services (no real network calls)