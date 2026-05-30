# Audit Log Export — Extended (#604)

## Overview
Async audit log export with date range + event type filtering, job polling, and signed download URLs that expire after a configurable duration.

## Endpoints
| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/audit-logs/export` | Queue async export job → returns `jobId` |
| GET | `/admin/audit-logs/export/:jobId/status` | Poll job completion |
| GET | `/admin/audit-logs/export/:jobId/download` | Get signed URL (202 if not ready) |

## Filters (POST body)
- `startDate` / `endDate` — ISO 8601 date range
- `eventType` — filter by audit log action
- `format` — `json` (default) or `csv`

## Signed URLs
URLs expire after `SIGNED_URL_EXPIRY_MS` ms (default 1 hour). Expired URLs are automatically regenerated on the next download request.

## Job States
`PENDING → PROCESSING → COMPLETED | FAILED`

Requesting `/download` before `COMPLETED` returns HTTP 202.

## Tests
`tests/audit-log-export-extended.test.js` — 25 tests covering filtering, async completion, signed URL expiry, format output, and error cases.
