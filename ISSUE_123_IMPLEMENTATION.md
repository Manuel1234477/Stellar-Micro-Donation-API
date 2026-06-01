# Issue #123 Implementation Summary

## Async Job Tracking for Donation Export

### Overview
Implemented async job tracking for the donations export endpoint to handle large datasets (100,000+ donations) without hitting HTTP timeout limits.

### Changes Made

#### 1. New Service: DonationExportService
**File:** `src/services/DonationExportService.js`

Core service that manages the entire export lifecycle:
- Job creation and queuing
- Background processing with `setImmediate()`
- CSV and JSON format generation
- Signed URL generation and verification (HMAC-SHA256)
- Automatic cleanup of expired exports (24-hour retention)
- URL expiry and regeneration (1-hour validity)

Key methods:
- `queueExportJob()` - Queue new export job
- `processExportJob()` - Background job processing
- `getJobStatus()` - Get job status with download URL
- `verifyAndGetDownload()` - Verify signed URL and serve file
- `deleteExpiredExports()` - Cleanup old exports

#### 2. Database Migration
**File:** `src/migrations/004_donation_exports.js`

Created `donation_exports` table with schema:
- `export_id` - Unique job identifier (format: `export-{timestamp}-{random}`)
- `api_key_id` - User who requested export
- Filter columns: `start_date`, `end_date`, `status_filter`, `sender_public_key`, `recipient_public_key`
- `format` - Export format (csv/json)
- `status` - Job status (queued/processing/completed/failed)
- `record_count` - Number of exported records
- `file_path` - Path to export file on disk
- `error_message` - Error details if failed
- `signed_url` - Download URL with HMAC token
- `signed_url_expires_at` - URL expiry timestamp
- Timestamps: `created_at`, `updated_at`

#### 3. API Endpoints
**File:** `src/routes/donation.js`

Added three new endpoints:

**POST /donations/export**
- Queue async export job
- Returns 202 Accepted with jobId
- Accepts filters: format, startDate, endDate, status, senderPublicKey, recipientPublicKey
- Requires admin role

**GET /donations/export/:jobId**
- Get job status
- Returns status, progress, downloadUrl (when completed), error
- Auto-regenerates expired download URLs
- Requires admin role

**GET /donations/export/:jobId/download**
- Download completed export file
- Verifies HMAC token and expiry
- Streams file to client
- Requires admin role

The old synchronous `GET /donations/export` endpoint is marked as deprecated but still functional.

#### 4. Cleanup Integration
**File:** `src/jobs/cleanupJob.js`

Integrated export cleanup into existing daily cleanup job:
- Calls `DonationExportService.deleteExpiredExports()`
- Removes exports older than 24 hours
- Deletes both database records and files

#### 5. Service Initialization
**File:** `src/routes/app.js`

Added service initialization during app startup:
- Import `DonationExportService`
- Call `DonationExportService.initialize()` to create tables and directories
- Runs after database migrations

#### 6. Comprehensive Tests
**File:** `tests/issues/issue-123-async-donation-export.test.js`

Test coverage includes:
- Job creation and queuing (POST endpoint)
- Status polling (GET status endpoint)
- Job lifecycle (queued → processing → completed)
- Download with valid/invalid/expired tokens
- CSV and JSON format generation
- Filter parameters (date range, status, public keys)
- Cleanup of expired exports
- URL expiry and regeneration
- Error handling and failed jobs
- Permission checks (admin role required)

#### 7. Documentation
**File:** `docs/ASYNC_DONATION_EXPORT.md`

Complete documentation covering:
- Problem statement and solution
- API endpoint specifications
- Usage examples (curl, JavaScript)
- Export formats (CSV/JSON)
- Technical implementation details
- Configuration options
- Security considerations
- Performance characteristics
- Migration guide from synchronous export

### Acceptance Criteria Status

✅ **POST /donations/export** accepts filter parameters and returns `{ "jobId": "export-<timestamp>" }` immediately (HTTP 202 Accepted)

✅ **GET /donations/export/:jobId** returns job status with:
- `status`: queued | processing | completed | failed
- `progress`: { processed: N, total: M }
- `downloadUrl`: signed URL (when completed and not expired)
- `urlExpiresAt`: ISO8601 timestamp
- `error`: error message (when failed)

✅ **Completed jobs** provide a downloadUrl valid for 1 hour
- HMAC-SHA256 signed URLs
- Automatic regeneration when expired

✅ **Jobs are cleaned up** after 24 hours
- File deleted from disk
- Database record removed
- Integrated into daily cleanup job

✅ **Requires admin role**
- All endpoints protected by `checkPermission(PERMISSIONS.ADMIN_ALL)`

✅ **Tests cover**:
- Job creation ✓
- Status polling (queued → processing → completed) ✓
- Download ✓
- URL expiry ✓
- Cleanup ✓

### Technical Decisions

1. **Database-backed job tracking** (not in-memory)
   - Persists across server restarts
   - Consistent with AuditLogExportService pattern

2. **File storage on disk** (not in-memory cache)
   - Handles large exports without memory pressure
   - Consistent with ExportService pattern

3. **setImmediate() for async processing** (not external queue)
   - Simple, no additional dependencies
   - Consistent with existing async job patterns (reconciliation, vacuum)

4. **HMAC-SHA256 signed URLs**
   - Secure, tamper-proof download links
   - Standard pattern used across the codebase

5. **24-hour retention, 1-hour URL expiry**
   - Balances security with usability
   - Configurable via environment variables

6. **Job ID format: `export-{timestamp}-{random}`**
   - Sortable by creation time
   - Globally unique
   - Human-readable

### Files Modified

- `src/services/DonationExportService.js` (new)
- `src/migrations/004_donation_exports.js` (new)
- `src/routes/donation.js` (modified - added 3 endpoints)
- `src/jobs/cleanupJob.js` (modified - added export cleanup)
- `src/routes/app.js` (modified - added service initialization)
- `tests/issues/issue-123-async-donation-export.test.js` (new)
- `docs/ASYNC_DONATION_EXPORT.md` (new)

### Configuration

Environment variables:
- `EXPORT_RETENTION_MS` - Export retention period (default: 24 hours)
- `SIGNED_URL_EXPIRY_MS` - Download URL expiry (default: 1 hour)
- `ENCRYPTION_KEY` - HMAC secret key (required)

### Deployment Notes

1. Run database migration to create `donation_exports` table
2. Ensure `data/exports/` directory is writable
3. Set `ENCRYPTION_KEY` environment variable in production
4. Monitor disk space usage for export files
5. Verify cleanup job runs daily

### Testing

Run tests:
```bash
npm test -- tests/issues/issue-123-async-donation-export.test.js
```

### Future Enhancements

Potential improvements identified:
- Real-time progress updates during processing
- Email notifications when export is ready
- Compression for large exports (gzip)
- S3/cloud storage integration
- Export job prioritization
- Scheduled/recurring exports

### Related Issues

- Issue #37: Original synchronous export implementation
- Issue #67: Reconciliation async job pattern (used as reference)
- Issue #604: Audit log async export (used as reference)

### Conclusion

The async donation export feature is fully implemented and tested. It provides a scalable solution for exporting large datasets without timeout issues, following established patterns in the codebase. All acceptance criteria have been met.
