# Geographic IP Blocking and Allowlisting

## Overview

The API implements geographic IP blocking and allowlisting to comply with sanctions regulations (OFAC, EU sanctions). This feature blocks requests from specified countries while allowing exceptions for allowlisted countries and IP addresses.

## Features

- **Country-based blocking**: Block requests from countries using ISO country codes
- **Country allowlisting**: Override blocking for specific countries
- **IP allowlisting**: Bypass geo-blocking for specific IP addresses or CIDR ranges
- **Dynamic configuration**: Update blocking rules via admin API without restart
- **Audit logging**: All blocked requests are logged with IP and country information
- **MaxMind GeoIP**: Uses MaxMind GeoLite2-Country database for accurate geolocation

## Configuration

### Environment Variables

```bash
# Comma-separated list of ISO country codes to block
GEO_BLOCKED_COUNTRIES=RU,IR,KP,CU

# Comma-separated list of ISO country codes to allow (overrides blocked countries)
GEO_ALLOWED_COUNTRIES=US,CA

# Comma-separated list of IP addresses/CIDR ranges to allow (bypasses geo-blocking)
GEO_ALLOWED_IPS=192.168.1.1,10.0.0.0/8,203.0.113.0/24

# Path to MaxMind GeoLite2-Country.mmdb database file
MAXMIND_DB_PATH=./data/GeoLite2-Country.mmdb
```

### MaxMind Database Setup

1. Download the GeoLite2-Country database from MaxMind:
   ```bash
   curl -L -o ./data/GeoLite2-Country.mmdb.gz "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=YOUR_LICENSE_KEY&suffix=tar.gz"
   tar -xzf GeoLite2-Country.mmdb.gz
   mv GeoLite2-Country_*/GeoLite2-Country.mmdb ./data/
   rm -rf GeoLite2-Country_*
   ```

2. For production, obtain a license key from MaxMind for the latest database.

## API Endpoints

### Get Current Configuration

```http
GET /admin/geo-blocking
Authorization: Bearer <admin-api-key>
```

Response:
```json
{
  "success": true,
  "data": {
    "blockedCountries": ["RU", "IR"],
    "allowedCountries": ["US"],
    "allowedIPs": ["192.168.1.1"],
    "maxmindDbPath": "./data/GeoLite2-Country.mmdb",
    "dbExists": true
  }
}
```

### Update Configuration

```http
PUT /admin/geo-blocking
Authorization: Bearer <admin-api-key>
Content-Type: application/json

{
  "blockedCountries": ["RU", "IR", "KP"],
  "allowedCountries": ["US", "CA"],
  "allowedIPs": ["192.168.1.1", "10.0.0.0/8"]
}
```

Response:
```json
{
  "success": true,
  "data": {
    "message": "Geo-blocking configuration updated successfully",
    "blockedCountries": ["RU", "IR", "KP"],
    "allowedCountries": ["US", "CA"],
    "allowedIPs": ["192.168.1.1", "10.0.0.0/8"],
    "note": "Changes are in-memory only. Restart server to persist or update environment variables."
  }
}
```

### Reload MaxMind Database

```http
POST /admin/geo-blocking/reload-db
Authorization: Bearer <admin-api-key>
```

Response:
```json
{
  "success": true,
  "data": {
    "message": "MaxMind database reloaded successfully",
    "dbPath": "./data/GeoLite2-Country.mmdb"
  }
}
```

## Blocking Logic

1. **IP Allowlist Check**: If the client IP is in the allowlist, allow the request
2. **Country Allowlist Check**: If the country is in the allowlist, allow the request
3. **Country Blocklist Check**: If the country is in the blocklist, block the request
4. **Default**: Allow the request

## Blocked Request Response

When a request is blocked, the API returns:

```http
HTTP/1.1 403 Forbidden
X-Blocked-Reason: geo
Content-Type: application/json

{
  "success": false,
  "error": {
    "code": "GEO_BLOCKED",
    "message": "Access denied from your location"
  }
}
```

## Audit Logging

All blocked requests are logged with the following information:

```json
{
  "level": "warn",
  "message": "Request blocked by geo-blocking",
  "ip": "203.0.113.1",
  "country": "RU",
  "path": "/api/v1/donations",
  "method": "POST",
  "userAgent": "Mozilla/5.0...",
  "reason": "geo"
}
```

## Security Considerations

- **Database Updates**: Regularly update the MaxMind database for accuracy
- **IP Spoofing**: The middleware uses `req.ip` which should be set by a trusted proxy
- **Performance**: GeoIP lookups are cached in memory for performance
- **Compliance**: Ensure blocking lists comply with applicable regulations
- **Monitoring**: Monitor blocked requests for false positives

## Testing

The feature includes comprehensive tests covering:

- Blocking by country code
- Allowlisting by country code
- IP allowlisting with CIDR ranges
- Audit logging verification
- Admin API configuration updates
- Edge cases and validation errors

Run tests with:
```bash
npm test tests/add-geographic-ip-blocking-and-allowlisting.test.js
```

## Implementation Details

- **Middleware Location**: `src/middleware/geoBlock.js`
- **Admin Routes**: `src/routes/admin/geoBlocking.js`
- **Configuration**: Added to `src/config/index.js`
- **Dependencies**: `maxmind` package for GeoIP lookups

## Troubleshooting

### Database Not Found
If the MaxMind database is missing, geo-blocking is disabled and all requests are allowed.

### Invalid Country Codes
The admin API validates ISO country codes (2 uppercase letters).

### IP Validation
IP addresses and CIDR ranges are validated for correct format.

### Configuration Not Persisting
Environment variable changes require server restart. Use the admin API for dynamic updates.