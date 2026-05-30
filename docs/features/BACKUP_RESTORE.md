# Database Backup and Restore

Automated, encrypted backup and restore for the SQLite database.

## Overview

- Backups are encrypted at rest using **AES-256-GCM** before writing to disk or S3.
- A scheduled backup runs automatically (default: every 24 hours) via `RecurringDonationScheduler`.
- Admin endpoints allow on-demand backup, listing, and restore.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENCRYPTION_KEY` | *(required)* | Key used to derive the AES-256 backup encryption key |
| `BACKUP_DIR` | `./data/backups` | Local directory for backup files |
| `BACKUP_INTERVAL_MS` | `86400000` (24 h) | Milliseconds between scheduled backups |
| `BACKUP_S3_BUCKET` | *(optional)* | S3 bucket name for remote storage |
| `BACKUP_S3_PREFIX` | `backups/` | Key prefix inside the S3 bucket |

## API Endpoints

All endpoints require admin (`*`) permission.

### Trigger a backup

```
POST /admin/backup
```

Response `201`:
```json
{
  "success": true,
  "data": {
    "backupId": "backup_1711449600000_a1b2c3d4",
    "filePath": "/data/backups/backup_1711449600000_a1b2c3d4.enc",
    "size": 204800,
    "createdAt": "2026-03-26T12:00:00.000Z"
  }
}
```

### List backups

```
GET /admin/backups
```

Response `200`:
```json
{
  "success": true,
  "data": [
    {
      "backupId": "backup_1711449600000_a1b2c3d4",
      "filePath": "/data/backups/backup_1711449600000_a1b2c3d4.enc",
      "size": 204800,
      "createdAt": "2026-03-26T12:00:00.000Z"
    }
  ]
}
```

### Restore from a backup

```
POST /admin/restore/:backupId
```

Response `200`:
```json
{
  "success": true,
  "data": {
    "backupId": "backup_1711449600000_a1b2c3d4",
    "restoredAt": "2026-03-26T13:00:00.000Z"
  }
}
```

## Encryption

Each backup file uses a fresh random 12-byte IV. The format on disk is:

```
[ IV (12 bytes) ][ Auth Tag (16 bytes) ][ Ciphertext ]
```

The encryption key is derived from `ENCRYPTION_KEY` via SHA-256 to produce a 32-byte AES key.

## Restore Atomicity

The restore operation:
1. Decrypts the backup to a temporary file.
2. Renames the current database to `<db>.pre-restore` (safety copy).
3. Renames the temp file to the live database path.

This ensures the database is never left in a partial state.

## S3 Storage

Set `BACKUP_S3_BUCKET` to enable S3 uploads. The service expects an AWS SDK v3-compatible `S3Client` instance passed via `new BackupService({ s3: client, s3Bucket: '...' })`, or reads `BACKUP_S3_BUCKET` / `BACKUP_S3_PREFIX` from the environment.

## Security Notes

- `ENCRYPTION_KEY` must be kept secret and backed up separately from the database files.
- Backup files are opaque without the key — losing the key means losing the backup.
- The `.pre-restore` file is not encrypted; delete it after confirming a successful restore.
