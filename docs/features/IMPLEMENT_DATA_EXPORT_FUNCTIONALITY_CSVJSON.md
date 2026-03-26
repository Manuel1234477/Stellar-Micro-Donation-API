# Implement Data Export Functionality (CSV/JSON)

This feature adds asynchronous organization data exports for donations, wallets, and audit logs in CSV and JSON formats.

## Security Assumptions

- All export endpoints require API key authentication.
- Export creation is tied to the authenticated requester (`requestedBy`).
- Download access uses signed URLs that expire after 1 hour.
- Export artifacts are automatically deleted after 24 hours.

## Endpoints

### `POST /exports`

Initiates an asynchronous export job.

Request body:

```json
{
  "type": "donations",
  "format": "csv",
  "startDate": "2026-01-01T00:00:00.000Z",
  "endDate": "2026-01-31T23:59:59.999Z"
}
```

Response (`202 Accepted`):

```json
{
  "success": true,
  "data": {
    "exportId": 42,
    "status": "pending"
  }
}
```

Validation rules:

- `type`: `donations | wallets | audit_logs`
- `format`: `csv | json`
- `startDate` and `endDate` must be valid dates
- `startDate <= endDate` when both are provided

### `GET /exports/:id`

Returns current status and metadata for an export job.

Response (`200 OK`):

```json
{
  "success": true,
  "data": {
    "id": 42,
    "status": "completed",
    "type": "donations",
    "format": "csv",
    "createdAt": "2026-03-25T11:00:00.000Z",
    "expiresAt": "2026-03-26T11:00:00.000Z",
    "downloadUrl": "http://localhost:3000/exports/42/download?expires=...&signature=..."
  }
}
```

Not found response (`404`):

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Export job not found"
  }
}
```

### `GET /exports/:id/download`

Returns a signed URL for completed exports.

Response (`200 OK`):

```json
{
  "success": true,
  "data": {
    "downloadUrl": "http://localhost:3000/exports/42/download?expires=...&signature=..."
  }
}
```

Pending export response (`400`):

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Export is not ready for download"
  }
}
```

Unknown ID response (`404`) follows the same format as `GET /exports/:id`.

## Async Export Flow

1. Client calls `POST /exports`.
2. API creates `export_jobs` record with `pending` status.
3. Background task generates export content and stores file.
4. Job is updated to `completed` with metadata and initial signed URL.
5. Client polls `GET /exports/:id` until `status === completed`.
6. Client calls `GET /exports/:id/download` to fetch a fresh 1-hour signed URL.

If generation fails, status becomes `failed` and the error is stored on the job record.

## Retention and Expiry

- `deleteExpiredExports()` removes jobs and files older than 24 hours.
- Signed URLs are generated with a 1-hour expiry window.
- Cleanup is idempotent and safe for scheduled invocation.
