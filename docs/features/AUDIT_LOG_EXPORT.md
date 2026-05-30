# API Key Audit Log Export

## Overview

The API Key Audit Log Export feature enables compliance teams to export audit logs for specific API keys for security reviews and incident investigations. Exports support date range filtering, JSON and CSV formats, and async generation for large datasets.

## Features

- **Date range filtering**: Filter logs by start and end dates
- **Action filtering**: Filter by specific audit actions
- **Multiple formats**: JSON and CSV output formats
- **Async generation**: Large exports (>1000 records) are processed asynchronously
- **Status tracking**: Real-time status updates for async exports
- **Compliance fields**: All required security and compliance fields included

## API Endpoints

### GET /api-keys/:id/audit-log

Export audit logs for a specific API key.

**Query Parameters:**
- `startDate` (optional): Filter by start date (ISO 8601)
- `endDate` (optional): Filter by end date (ISO 8601)
- `action` (optional): Filter by specific action
- `format` (optional): Output format (`json` or `csv`, default: `json`)

**Response (Small Dataset - Synchronous):**
```json
{
  "success": true,
  "data": {
    "exportId": "abc123...",
    "status": "COMPLETED",
    "recordCount": 100,
    "format": "json",
    "async": false,
    "content": [...],
    "message": "Export completed. 100 records exported."
  }
}
```

**Response (Large Dataset - Asynchronous):**
```json
{
  "success": true,
  "data": {
    "exportId": "abc123...",
    "status": "PENDING",
    "recordCount": 2000,
    "format": "json",
    "async": true,
    "message": "Export initiated. 2000 records will be processed asynchronously.",
    "statusUrl": "/api-keys/api-key-123/audit-log/export/abc123..."
  }
}
```

**Response Headers (CSV):**
```
Content-Type: text/csv
Content-Disposition: attachment; filename="audit-log-api-key-123-1705312500000.csv"
```

### GET /api-keys/:id/audit-log/export/:exportId

Get status of an async export.

**Response:**
```json
{
  "success": true,
  "data": {
    "exportId": "abc123...",
    "status": "COMPLETED",
    "recordCount": 2000,
    "format": "json",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z",
    "errorMessage": null,
    "downloadUrl": "/api-keys/api-key-123/audit-log/export/abc123.../download"
  }
}
```

### GET /api-keys/:id/audit-log/export/:exportId/download

Download completed export.

**Response:**
```
Content-Type: application/json (or text/csv)
Content-Disposition: attachment; filename="audit-log-api-key-123-abc123....json"
```

### GET /api-keys/:id/audit-log/exports

List all exports for an API key.

**Query Parameters:**
- `limit` (optional): Maximum results (1-1000, default: 50)
- `offset` (optional): Pagination offset (default: 0)

**Response:**
```json
{
  "success": true,
  "data": {
    "exports": [
      {
        "exportId": "abc123...",
        "format": "json",
        "status": "COMPLETED",
        "recordCount": 100,
        "createdAt": "2024-01-15T10:30:00.000Z",
        "updatedAt": "2024-01-15T10:35:00.000Z"
      }
    ],
    "count": 1,
    "apiKeyId": "api-key-123"
  }
}
```

### GET /api-keys/:id/audit-log/stats

Get audit log statistics for an API key.

**Query Parameters:**
- `startDate` (optional): Filter by start date (ISO 8601)
- `endDate` (optional): Filter by end date (ISO 8601)

**Response:**
```json
{
  "success": true,
  "data": {
    "apiKeyId": "api-key-123",
    "totalCount": 1500,
    "statistics": [
      {
        "category": "AUTHENTICATION",
        "action": "API_KEY_VALIDATED",
        "severity": "LOW",
        "result": "SUCCESS",
        "count": 1200
      }
    ],
    "dateRange": {
      "startDate": "2024-01-01",
      "endDate": "2024-12-31"
    }
  }
}
```

## Export Statuses

| Status | Description |
|--------|-------------|
| `PENDING` | Export has been queued for processing |
| `PROCESSING` | Export is currently being generated |
| `COMPLETED` | Export is ready for download |
| `FAILED` | Export failed (see errorMessage) |

## Async Export Threshold

Exports with more than 1000 records are processed asynchronously to avoid timeout issues. The threshold is configurable via `ASYNC_EXPORT_THRESHOLD`.

## Compliance Fields

All exports include the following compliance fields:

| Field | Description |
|-------|-------------|
| `id` | Unique audit log ID |
| `timestamp` | ISO 8601 timestamp of the event |
| `category` | Event category (e.g., AUTHENTICATION, FINANCIAL_OPERATION) |
| `action` | Specific action (e.g., API_KEY_VALIDATED, DONATION_CREATED) |
| `severity` | Event severity (HIGH, MEDIUM, LOW) |
| `result` | Operation result (SUCCESS, FAILURE) |
| `userId` | API key or user identifier |
| `requestId` | Request correlation ID |
| `ipAddress` | Client IP address |
| `resource` | Resource being accessed |
| `reason` | Reason for failure (if applicable) |
| `details` | Additional context (JSON) |

## CSV Format

CSV exports include all compliance fields as columns:

```csv
id,timestamp,category,action,severity,result,userId,requestId,ipAddress,resource,reason,details
1,2024-01-15T10:30:00.000Z,AUTHENTICATION,API_KEY_VALIDATED,LOW,SUCCESS,api-key-123,req-1,127.0.0.1,/api/test,,"{""key"":""value""}"
```

## JSON Format

JSON exports include all compliance fields as objects:

```json
[
  {
    "id": 1,
    "timestamp": "2024-01-15T10:30:00.000Z",
    "category": "AUTHENTICATION",
    "action": "API_KEY_VALIDATED",
    "severity": "LOW",
    "result": "SUCCESS",
    "userId": "api-key-123",
    "requestId": "req-1",
    "ipAddress": "127.0.0.1",
    "resource": "/api/test",
    "reason": null,
    "details": {
      "key": "value"
    }
  }
]
```

## Security Considerations

1. **Admin only**: All export endpoints require admin role
2. **API key validation**: Verifies API key exists before export
3. **Ownership check**: Export status checks verify ownership
4. **Audit logging**: All export requests are logged
5. **No PII exposure**: Sensitive fields are redacted in logs

## Testing

Run tests with:

```bash
npm test tests/audit-log-export.test.js
```

Tests verify:
- Date range filtering works correctly
- JSON and CSV formats both valid
- Async export status polling
- All required compliance fields present
- CSV field escaping
- JSON structure validation

## Examples

### Export Last 30 Days of Logs

```javascript
const result = await AuditLogExportService.initiateExport('api-key-123', {
  startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  endDate: new Date().toISOString(),
  format: 'json'
});

if (result.async) {
  console.log(`Export queued: ${result.statusUrl}`);
} else {
  console.log(`Export completed: ${result.recordCount} records`);
}
```

### Export Specific Action

```javascript
const result = await AuditLogExportService.initiateExport('api-key-123', {
  action: 'DONATION_CREATED',
  format: 'csv'
});
```

### Check Export Status

```javascript
const status = await AuditLogExportService.getExportStatus('api-key-123', 'export-123');

if (status.status === 'COMPLETED') {
  console.log(`Download: ${status.downloadUrl}`);
} else if (status.status === 'FAILED') {
  console.error(`Export failed: ${status.errorMessage}`);
}
```

### List All Exports

```javascript
const exports = await AuditLogExportService.getExports('api-key-123', {
  limit: 10,
  offset: 0
});

exports.forEach(exp => {
  console.log(`${exp.exportId}: ${exp.status} (${exp.recordCount} records)`);
});
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| 404 Not Found | API key not found | Verify API key ID exists |
| 400 Bad Request | Invalid date range | Ensure start date < end date |
| 400 Bad Request | Invalid format | Use 'json' or 'csv' |
| 404 Not Found | No logs found | Verify date range has data |
| 400 Bad Request | Export not ready | Check status before download |

### Example Error Response

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Start date must be before end date"
  }
}
```

## Performance Considerations

1. **Small exports (<1000 records)**: Synchronous, immediate response
2. **Large exports (>1000 records)**: Asynchronous, status polling required
3. **Pagination**: Use limit/offset for listing exports
4. **Date filtering**: Narrow date ranges improve performance
5. **Action filtering**: Specific actions reduce result set size

## Database Schema

The `audit_log_exports` table stores export metadata:

```sql
CREATE TABLE audit_log_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  export_id TEXT UNIQUE NOT NULL,
  api_key_id TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  action_filter TEXT,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  file_path TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
);
```

## Future Enhancements

- **File storage**: Store exports in S3/GCS for large files
- **Email notifications**: Notify when async exports complete
- **Export scheduling**: Schedule recurring exports
- **Compression**: Compress large exports
- **Encryption**: Encrypt sensitive exports
