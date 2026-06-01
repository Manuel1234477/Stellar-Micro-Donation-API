# Async Donation Export (Issue #123)

## Overview

The async donation export feature provides a scalable solution for exporting large donation datasets without hitting HTTP timeout limits. Instead of streaming data synchronously, the system queues export jobs that run in the background and provide downloadable files when complete.

## Problem Statement

The previous `GET /donations/export` endpoint processed exports synchronously, which caused issues with large datasets:
- Exports of 100,000+ donations took 30-60 seconds
- Many load balancers and API gateways have 30-second timeout limits
- Requests would timeout before completion, leaving clients with no data
- No way to track export progress or retry failed exports

## Solution

The async export pattern:
1. Client submits an export request via `POST /donations/export`
2. Server immediately returns a job ID (HTTP 202 Accepted)
3. Export runs in the background
4. Client polls `GET /donations/export/:jobId` for status
5. When complete, client downloads file via signed URL
6. Files and jobs are automatically cleaned up after 24 hours

## API Endpoints

### POST /donations/export

Queue an async export job.

**Authentication:** Requires admin role

**Request Body:**
```json
{
  "format": "csv",
  "startDate": "2024-01-01T00:00:00Z",
  "endDate": "2024-12-31T23:59:59Z",
  "status": "completed",
  "senderPublicKey": "GXXX...",
  "recipientPublicKey": "GYYY..."
}
```

**Parameters:**
- `format` (required): Export format - `csv` or `json`
- `startDate` (optional): ISO 8601 date string - filter donations after this date
- `endDate` (optional): ISO 8601 date string - filter donations before this date
- `status` (optional): Transaction status filter - `pending`, `completed`, `failed`
- `senderPublicKey` (optional): Filter by sender's Stellar public key
- `recipientPublicKey` (optional): Filter by recipient's Stellar public key

**Response (202 Accepted):**
```json
{
  "success": true,
  "data": {
    "jobId": "export-1234567890-abcd1234",
    "status": "queued"
  }
}
```

**Error Responses:**
- `400 Bad Request`: Invalid format or date range
- `401 Unauthorized`: Missing or invalid API key
- `403 Forbidden`: Insufficient permissions (requires admin role)

### GET /donations/export/:jobId

Get the status of an export job.

**Authentication:** Requires admin role

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "jobId": "export-1234567890-abcd1234",
    "status": "completed",
    "progress": {
      "processed": 150000,
      "total": 150000
    },
    "downloadUrl": "/donations/export/export-1234567890-abcd1234/download?token=abc123&expires=2024-01-01T12:00:00Z",
    "urlExpiresAt": "2024-01-01T12:00:00Z",
    "error": null,
    "createdAt": "2024-01-01T10:00:00Z",
    "updatedAt": "2024-01-01T10:05:00Z"
  }
}
```

**Status Values:**
- `queued`: Job is waiting to be processed
- `processing`: Job is currently running
- `completed`: Job finished successfully, download URL available
- `failed`: Job encountered an error

**Fields:**
- `jobId`: Unique job identifier
- `status`: Current job status
- `progress.processed`: Number of records processed
- `progress.total`: Total number of records (same as processed when complete)
- `downloadUrl`: Signed URL for downloading the file (only present when status is `completed` and URL is not expired)
- `urlExpiresAt`: ISO 8601 timestamp when the download URL expires (1 hour from generation)
- `error`: Error message if status is `failed`
- `createdAt`: ISO 8601 timestamp when job was created
- `updatedAt`: ISO 8601 timestamp when job was last updated

**Error Responses:**
- `404 Not Found`: Job ID does not exist

### GET /donations/export/:jobId/download

Download the completed export file.

**Authentication:** Requires admin role

**Query Parameters:**
- `token` (required): HMAC signature for URL verification
- `expires` (required): ISO 8601 expiry timestamp

**Response (200 OK):**
- Content-Type: `text/csv` or `application/json` depending on format
- Content-Disposition: `attachment; filename="donations-{jobId}.{format}"`
- Body: Export file content

**Error Responses:**
- `400 Bad Request`: Missing parameters, invalid token, or expired URL
- `404 Not Found`: Job or file not found

## Usage Examples

### Basic CSV Export

```bash
# 1. Queue the export job
curl -X POST https://api.example.com/donations/export \
  -H "X-API-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{"format": "csv"}'

# Response:
# {
#   "success": true,
#   "data": {
#     "jobId": "export-1234567890-abcd1234",
#     "status": "queued"
#   }
# }

# 2. Poll for status (repeat until status is "completed")
curl https://api.example.com/donations/export/export-1234567890-abcd1234 \
  -H "X-API-Key: your-admin-key"

# Response when completed:
# {
#   "success": true,
#   "data": {
#     "jobId": "export-1234567890-abcd1234",
#     "status": "completed",
#     "downloadUrl": "/donations/export/export-1234567890-abcd1234/download?token=abc123&expires=2024-01-01T12:00:00Z",
#     ...
#   }
# }

# 3. Download the file
curl "https://api.example.com/donations/export/export-1234567890-abcd1234/download?token=abc123&expires=2024-01-01T12:00:00Z" \
  -H "X-API-Key: your-admin-key" \
  -o donations.csv
```

### Filtered JSON Export

```bash
# Export only completed donations from Q1 2024
curl -X POST https://api.example.com/donations/export \
  -H "X-API-Key: your-admin-key" \
  -H "Content-Type: application/json" \
  -d '{
    "format": "json",
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-03-31T23:59:59Z",
    "status": "completed"
  }'
```

### JavaScript/Node.js Example

```javascript
const axios = require('axios');

async function exportDonations() {
  const apiKey = 'your-admin-key';
  const baseUrl = 'https://api.example.com';

  // 1. Queue export job
  const { data: queueResponse } = await axios.post(
    `${baseUrl}/donations/export`,
    {
      format: 'csv',
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-12-31T23:59:59Z',
    },
    {
      headers: { 'X-API-Key': apiKey },
    }
  );

  const jobId = queueResponse.data.jobId;
  console.log(`Export job queued: ${jobId}`);

  // 2. Poll for completion
  let status;
  while (true) {
    const { data: statusResponse } = await axios.get(
      `${baseUrl}/donations/export/${jobId}`,
      {
        headers: { 'X-API-Key': apiKey },
      }
    );

    status = statusResponse.data;
    console.log(`Status: ${status.status}, Progress: ${status.progress.processed}/${status.progress.total}`);

    if (status.status === 'completed') {
      break;
    } else if (status.status === 'failed') {
      throw new Error(`Export failed: ${status.error}`);
    }

    // Wait 2 seconds before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // 3. Download file
  const downloadUrl = `${baseUrl}${status.downloadUrl}`;
  const { data: fileContent } = await axios.get(downloadUrl, {
    headers: { 'X-API-Key': apiKey },
  });

  console.log('Export downloaded successfully');
  return fileContent;
}

exportDonations().catch(console.error);
```

## Export Formats

### CSV Format

CSV exports include the following columns:
- `id`: Transaction ID
- `amount`: Donation amount in XLM
- `senderPublicKey`: Sender's Stellar public key
- `recipientPublicKey`: Recipient's Stellar public key
- `memo`: Transaction memo
- `status`: Transaction status
- `timestamp`: ISO 8601 timestamp
- `transactionHash`: Stellar transaction hash

Example:
```csv
id,amount,senderPublicKey,recipientPublicKey,memo,status,timestamp,transactionHash
1,10,GXXX...,GYYY...,Donation 1,completed,2024-01-01T10:00:00Z,abc123...
2,20,GXXX...,GYYY...,Donation 2,completed,2024-01-01T11:00:00Z,def456...
```

### JSON Format

JSON exports return an array of donation objects:
```json
[
  {
    "id": 1,
    "amount": 10,
    "senderPublicKey": "GXXX...",
    "recipientPublicKey": "GYYY...",
    "memo": "Donation 1",
    "status": "completed",
    "timestamp": "2024-01-01T10:00:00Z",
    "transactionHash": "abc123..."
  },
  {
    "id": 2,
    "amount": 20,
    "senderPublicKey": "GXXX...",
    "recipientPublicKey": "GYYY...",
    "memo": "Donation 2",
    "status": "completed",
    "timestamp": "2024-01-01T11:00:00Z",
    "transactionHash": "def456..."
  }
]
```

## Technical Implementation

### Architecture

The async export system consists of:

1. **DonationExportService** (`src/services/DonationExportService.js`)
   - Manages export job lifecycle
   - Generates export files
   - Handles signed URL generation and verification
   - Implements cleanup logic

2. **Database Table** (`donation_exports`)
   - Stores job metadata and status
   - Tracks progress and errors
   - Stores signed URL and expiry

3. **File Storage** (`data/exports/`)
   - Export files stored on disk
   - Named as `export-{jobId}.{format}`
   - Automatically cleaned up after 24 hours

4. **Background Processing**
   - Uses `setImmediate()` for async execution
   - Jobs run in Node.js event loop
   - No external queue system required

### Job Lifecycle

```
┌─────────┐
│ QUEUED  │ ← Job created, waiting to start
└────┬────┘
     │
     ▼
┌────────────┐
│ PROCESSING │ ← Job is running
└─────┬──────┘
      │
      ├─────────────┐
      │             │
      ▼             ▼
┌───────────┐  ┌────────┐
│ COMPLETED │  │ FAILED │
└───────────┘  └────────┘
```

### Signed URLs

Download URLs are secured using HMAC-SHA256 signatures:

1. Token generation: `HMAC-SHA256(jobId:expiresAt, ENCRYPTION_KEY)`
2. URL format: `/donations/export/:jobId/download?token={token}&expires={expiresAt}`
3. Verification: Server recomputes token and compares
4. Expiry: URLs expire after 1 hour (configurable via `SIGNED_URL_EXPIRY_MS`)
5. Regeneration: Expired URLs are automatically regenerated when status is polled

### Cleanup

The cleanup job (`src/jobs/cleanupJob.js`) runs daily and:
1. Identifies exports older than 24 hours
2. Deletes export files from disk
3. Removes database records
4. Logs cleanup activity

Retention period is configurable via `EXPORT_RETENTION_MS` environment variable.

## Configuration

Environment variables:

- `EXPORT_RETENTION_MS`: Export file retention period in milliseconds (default: 86400000 = 24 hours)
- `SIGNED_URL_EXPIRY_MS`: Download URL expiry time in milliseconds (default: 3600000 = 1 hour)
- `ENCRYPTION_KEY`: Secret key for HMAC signature generation (required in production)

## Monitoring

### Metrics to Track

- Export job queue length
- Average job processing time
- Job success/failure rate
- Export file sizes
- Download URL expiry rate

### Logs

The service logs the following events:
- `DONATION_EXPORT_SERVICE` - Export tables and storage initialized
- `DONATION_EXPORT_SERVICE` - Export job completed (includes jobId, records, format)
- `DONATION_EXPORT_SERVICE` - Export job failed (includes jobId, error)
- `DONATION_EXPORT_SERVICE` - Deleted expired exports (includes count)

## Migration from Synchronous Export

The old synchronous `GET /donations/export` endpoint is still available but deprecated. To migrate:

1. Update client code to use `POST /donations/export` instead of `GET`
2. Implement polling logic for job status
3. Use signed download URLs instead of streaming response
4. Handle job failures and retries

The synchronous endpoint will be removed in a future version.

## Testing

Comprehensive tests are available in `tests/issues/issue-123-async-donation-export.test.js`:

- Job creation and queuing
- Status polling and progress tracking
- Download with valid/invalid/expired tokens
- CSV and JSON format generation
- Filter parameters (date range, status, public keys)
- Cleanup of expired exports
- URL expiry and regeneration
- Error handling

Run tests:
```bash
npm test -- tests/issues/issue-123-async-donation-export.test.js
```

## Security Considerations

1. **Authentication**: All endpoints require admin role
2. **Signed URLs**: HMAC-based signatures prevent URL tampering
3. **Expiry**: Download URLs expire after 1 hour to limit exposure
4. **Cleanup**: Files are automatically deleted after 24 hours
5. **Rate Limiting**: Standard API rate limits apply to prevent abuse
6. **Input Validation**: All filter parameters are validated before processing

## Performance

- **Scalability**: Handles datasets of 100,000+ donations without timeout
- **Memory**: Streams data in batches to minimize memory usage
- **Disk**: Export files stored temporarily on disk
- **Concurrency**: Multiple export jobs can run simultaneously
- **Cleanup**: Automatic cleanup prevents disk space exhaustion

## Future Enhancements

Potential improvements:
- Progress updates during processing (currently shows only queued/processing/completed)
- Email notification when export is ready
- Compression for large exports (gzip)
- S3/cloud storage integration for distributed systems
- Export job prioritization
- Scheduled/recurring exports
- Export templates and saved filters
