# API Key Usage Anomaly Detection

Detects suspicious API key usage patterns and sends webhook alerts.

## How It Works

Each request is recorded per key. Once a key has ≥10 requests (baseline), anomalies are checked:

| Anomaly Type | Trigger |
|---|---|
| `NEW_COUNTRY` | Request from a country not seen in baseline |
| `VOLUME_SPIKE` | Current-hour count > 3× baseline hourly average |
| `OFF_HOURS_ACCESS` | Request at UTC 22:00–06:00 when <10% of baseline was off-hours |

**Cold-start**: Keys with fewer than 10 requests are in "learning" mode — no anomalies raised.

## Endpoint

```
GET /api-keys/:id/anomalies
Authorization: Bearer <admin-key>
```

Response:
```json
{
  "success": true,
  "data": {
    "keyId": "42",
    "anomalies": [
      { "type": "NEW_COUNTRY", "detail": "First request from country: CN", "timestamp": 1700000000000 }
    ]
  }
}
```

## Webhook Alerts

Set `ANOMALY_WEBHOOK_URL` in `.env` to receive alerts:

```json
{
  "event": "api_key.anomaly_detected",
  "keyId": "42",
  "anomalies": [{ "type": "NEW_COUNTRY", "detail": "..." }],
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Webhook failures are logged as warnings and do not block the request.

## Security Assumptions

- Baseline cold-start: new keys cannot trigger false positives until 10 requests are recorded
- Country detection requires a populated `country` field in request metadata (defaults to `'unknown'`, which is never flagged as new)
- Off-hours threshold (10%) reduces false positives for keys with mixed usage patterns
