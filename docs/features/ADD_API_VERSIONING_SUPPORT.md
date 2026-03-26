# API Versioning Policy

## Overview
The Stellar Micro-Donation API uses a versioning strategy to ensure backward compatibility and smooth transitions during breaking changes. Our primary method of versioning is **URL Path Versioning**, with an alternative support via the **Accept header**.

## Current Versions
- **v1**: Active and default version.

## How to Specify an API Version

### 1. URL Path Versioning (Recommended)
You can include the version directly in the URL path. All endpoints are accessible with the `/api/v1/` prefix.

**Example:**
\`\`\`http
GET /api/v1/wallets
\`\`\`

### 2. Accept Header Negotiation (Alternative)
You can specify the version in the `Accept` header. If a version is not provided in the URL path, the API will inspect the `Accept` header.

**Examples:**
\`\`\`http
GET /wallets
Accept: application/json; version=1
\`\`\`
or
\`\`\`http
GET /wallets
Accept: application/vnd.myapi.v1+json
\`\`\`

### 3. Default Behavior
If no version information is provided either in the URL or the `Accept` header, the API defaults to **v1**.

## Response Headers
Every API response includes information about the version being used:

- \`X-API-Version\`: The version number used to process the request (e.g., \`1\`).

## Deprecation Policy
When an API version is deprecated, it continues to work but will include additional headers alerting developers to the impending unsupport date.

Deprecated versions will include:
- \`X-API-Deprecated: true\`
- \`Sunset: <date>\` (The exact date when the version will be permanently removed)
- \`Warning: 199 - "API version X is deprecated and will be removed on <date>"\`

### Transition Period
We provide a minimum transition period (typically 6 months) for any deprecated API version. Clients are encouraged to monitor response headers and update integrations before the \`Sunset\` date.

## Security Assumptions
- The versioning middleware processes requests efficiently and mitigates matching overhead and DoS vectors using strict RegExp.
- Route prefixes prevent path traversal or unexpected routing overlaps.
- Defaulting to v1 limits the surface area of potential ambiguous request routing behavior. Validate security assumptions during major version transitions.
