# Subscription Tier Feature Gating

HTTP 402 enforcement for tier-gated API features with `X-Required-Tier` response header.

## Tiers

| Tier | Features | Rate Limit |
|------|----------|------------|
| `free` | Basic donations, wallet read, stats | 10/day |
| `basic` | + wallet create, transactions | 100/day |
| `pro` | + advanced analytics, export | 1000/day |
| `enterprise` | + bulk import | Unlimited |

## How It Works

The `requireTier(minTier)` middleware factory checks the API key's `tier` column against the minimum required tier. Admin keys bypass tier gating entirely.

```
free < basic < pro < enterprise
```

If the key's tier is below the minimum, the middleware responds:

```
HTTP 402 Payment Required
X-Required-Tier: pro

{
  "success": false,
  "error": {
    "code": "TIER_REQUIRED",
    "message": "This feature requires the 'pro' tier or higher. Your current tier: 'free'.",
    "requiredTier": "pro",
    "currentTier": "free"
  }
}
```

## Gated Endpoints

| Endpoint | Minimum Tier |
|----------|-------------|
| `POST /exports` | `pro` |
| `GET /exports/:id` | `pro` |
| `GET /stats/wallet/:addr/analytics` | `pro` |
| `POST /wallets/bulk-import` | `enterprise` |

## Public Endpoint

```
GET /tiers/features
```

Returns all tiers with their features and limits — no authentication required.

```json
{
  "success": true,
  "data": [
    { "tier": "free", "label": "Free", "features": [...], "limits": { "donationsPerDay": 10 } },
    { "tier": "pro",  "label": "Pro",  "features": [...], "limits": { "donationsPerDay": 1000 } }
  ]
}
```

## API Key Tier Endpoint

```
GET /api-keys/:id/tier
```

Admin only. Returns the current tier for an API key.

```json
{ "success": true, "data": { "id": 5, "name": "My Key", "tier": "pro" } }
```

## Upgrading a Key's Tier

Use `PATCH /api-keys/:id` (admin) to update the `tier` field:

```json
{ "tier": "enterprise" }
```

The change takes effect immediately on the next request.

## Adding `requireTier` to a New Endpoint

```js
const { requireTier } = require('../middleware/rbac');

router.post('/my-feature', requireApiKey, requireTier('pro'), async (req, res) => {
  // only pro+ keys reach here
});
```
