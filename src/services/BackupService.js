/**
 * BackupService - Database Backup and Restore
 *
 * RESPONSIBILITY: AES-256-GCM encrypted SQLite backup creation, listing, and restore
 * OWNER: Backend Team
 * DEPENDENCIES: crypto, fs, path, database utility, encryption utility, logger
 *
 * Supports local file storage and S3-compatible object storage backends.
 * All backups are encrypted at rest using AES-256-GCM before writing to disk/S3.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const sqlite3 = require('sqlite3').verbose();
const log = require('../utils/log');
const { env } = require('../config/env');
const cryptoCore = require('../utils/crypto');

const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');
// Relative paths resolve against the project root; absolute paths are kept as-is.
const BACKUP_DIR = env.BACKUP_DIR
  ? path.resolve(__dirname, '../..', env.BACKUP_DIR)
  : (process.env.BACKUP_DIR || path.join(__dirname, '../../data/backups'));

// ─── Backup file format and key management (#1951) ───────────────────────────
//
// v2 (current):  "SBK2" | keyIdLength (1 byte) | keyId (utf8) | iv (12) | authTag (16) | ciphertext
//   - The key is HKDF-SHA256(material, info="stellar-backup-v1"), never a bare hash.
//   - keyId names the key that encrypted the file, so restore can pick the right one.
// v1 (legacy):   iv (12) | authTag (16) | ciphertext, key = SHA-256(ENCRYPTION_KEY).
//   Written before #1951. Still readable so existing backups stay restorable.
//
// Keys come from the environment:
//   BACKUP_ENCRYPTION_KEY  dedicated backup key material (optional; falls back to ENCRYPTION_KEY)
//   BACKUP_KEY_ID          id written into new backups (optional; derived from the material by default)
//   BACKUP_PREVIOUS_KEYS   "id:material,id:material" keys kept so older backups can be restored

const BACKUP_MAGIC = Buffer.from('SBK2', 'ascii');
const BACKUP_KDF_INFO = 'stellar-backup-v1';
const BACKUP_KEY_ID_INFO = 'stellar-backup-key-id';

/**
 * Derive the 32-byte AES key for a backup from key material.
 * @param {string} material
 * @returns {Buffer}
 */
function deriveBackupKey(material) {
  return Buffer.from(crypto.hkdfSync('sha256', material, Buffer.alloc(0), BACKUP_KDF_INFO, 32));
}

/**
 * Stable identifier for key material, written into backup headers.
 * Derived with HKDF so the header does not expose a bare hash of the key.
 * @param {string} material
 * @returns {string} 16 hex characters
 */
function deriveBackupKeyId(material) {
  return Buffer.from(crypto.hkdfSync('sha256', material, Buffer.alloc(0), BACKUP_KEY_ID_INFO, 8)).toString('hex');
}

/**
 * Parse BACKUP_PREVIOUS_KEYS ("id:material,id:material").
 * @returns {Array<{id: string, material: string}>}
 */
function parsePreviousKeys() {
  const raw = process.env.BACKUP_PREVIOUS_KEYS || '';
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const idx = entry.indexOf(':');
      if (idx <= 0 || idx === entry.length - 1) {
        throw new Error('BACKUP_PREVIOUS_KEYS entries must be "id:material"');
      }
      return { id: entry.slice(0, idx).trim(), material: entry.slice(idx + 1).trim() };
    });
}

/**
 * Keys available to this process.
 * @returns {{ active: {id: string, key: Buffer}, byId: Map<string, Buffer>, legacyMaterials: string[] }}
 */
function getBackupKeyring() {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const activeMaterial = process.env.BACKUP_ENCRYPTION_KEY || encryptionKey;
  if (!activeMaterial) throw new Error('ENCRYPTION_KEY is required for backup encryption');

  const activeId = (process.env.BACKUP_KEY_ID || '').trim() || deriveBackupKeyId(activeMaterial);
  const byId = new Map();
  const previous = parsePreviousKeys();
  for (const { id, material } of previous) {
    byId.set(id, deriveBackupKey(material));
  }
  const active = { id: activeId, key: deriveBackupKey(activeMaterial) };
  byId.set(activeId, active.key);

  // Unversioned files were encrypted with SHA-256(ENCRYPTION_KEY) (or a previous ENCRYPTION_KEY).
  const legacyMaterials = [encryptionKey, ...previous.map((p) => p.material)]
    .filter((m, i, all) => m && all.indexOf(m) === i);

  return { active, byId, legacyMaterials };
}

/**
 * Encrypt backup bytes with the active key (v2 format).
 * @param {Buffer} data
 * @returns {Buffer}
 */
function encryptBuffer(data) {
  const { active } = getBackupKeyring();
  const { iv, tag, ciphertext } = cryptoCore.seal(active.key, data);
  const id = Buffer.from(active.id, 'utf8');
  if (id.length > 255) throw new Error('BACKUP_KEY_ID is too long');
  const header = Buffer.concat([BACKUP_MAGIC, Buffer.from([id.length]), id]);
  return Buffer.concat([header, iv, tag, ciphertext]);
}

/**
 * Read the key id from a v2 backup, or null for legacy files.
 * @param {Buffer} data
 * @returns {string|null}
 */
function readBackupKeyId(data) {
  if (!Buffer.isBuffer(data) || data.length < BACKUP_MAGIC.length + 1) return null;
  if (!data.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) return null;
  const idLen = data[BACKUP_MAGIC.length];
  const start = BACKUP_MAGIC.length + 1;
  if (data.length < start + idLen) return null;
  return data.subarray(start, start + idLen).toString('utf8');
}

/**
 * Decrypt a backup produced by encryptBuffer (v2) or by the legacy scheme (v1).
 * @param {Buffer} data
 * @returns {Buffer}
 * @throws {Error} when no configured key can decrypt the file
 */
function decryptBuffer(data) {
  const { IV_BYTES, TAG_BYTES } = cryptoCore;
  const keyring = getBackupKeyring();
  const keyId = readBackupKeyId(data);

  if (keyId !== null) {
    const headerLength = BACKUP_MAGIC.length + 1 + Buffer.byteLength(keyId, 'utf8');
    const key = keyring.byId.get(keyId);
    if (!key) {
      throw new Error(`No backup key configured for key id "${keyId}". Add it to BACKUP_PREVIOUS_KEYS.`);
    }
    const body = data.subarray(headerLength);
    return cryptoCore.open(key, {
      iv: body.subarray(0, IV_BYTES),
      tag: body.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
      ciphertext: body.subarray(IV_BYTES + TAG_BYTES),
    });
  }

  // Legacy (v1) file: no header, SHA-256 key derivation.
  for (const material of keyring.legacyMaterials) {
    try {
      return cryptoCore.open(cryptoCore.deriveKey(material), {
        iv: data.subarray(0, IV_BYTES),
        tag: data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
        ciphertext: data.subarray(IV_BYTES + TAG_BYTES),
      });
    } catch (_err) {
      // Try the next configured key.
    }
  }
  throw new Error('Backup could not be decrypted with any configured key');
}

class BackupService {
  /**
   * @param {object} [options]
   * @param {string} [options.dbPath]       - Path to the SQLite database file
   * @param {string} [options.backupDir]    - Local directory for backup files
   * @param {object} [options.s3]           - Optional S3 client (aws-sdk v3 S3Client or compatible)
   * @param {string} [options.s3Bucket]     - S3 bucket name
   * @param {string} [options.s3Prefix]     - Key prefix inside the bucket (default: 'backups/')
   */
  constructor(options = {}) {
    this.dbPath = options.dbPath || DB_PATH;
    this.backupDir = options.backupDir || BACKUP_DIR;
    this.s3 = options.s3 || null;
    this.s3Bucket = options.s3Bucket || process.env.BACKUP_S3_BUCKET || null;
    this.s3Prefix = options.s3Prefix || process.env.BACKUP_S3_PREFIX || 'backups/';
    /** @type {{backupId: string, passed: boolean, checkedAt: string, details: object}|null} */
    this.lastVerification = null;
  }

  /**
   * Create an encrypted backup of the SQLite database.
   *
   * Reads the live database file, encrypts it with AES-256-GCM, writes it to
   * the local backup directory, and optionally uploads it to S3.
   *
   * @returns {Promise<{backupId: string, filePath: string, size: number, createdAt: string}>}
   */
  async backup() {
    const backupId = `backup_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const fileName = `${backupId}.enc`;

    log.info('BACKUP', 'Starting database backup', { backupId, dbPath: this.dbPath });

    if (!fs.existsSync(this.dbPath)) {
      throw new Error(`Database file not found: ${this.dbPath}`);
    }

    const raw = fs.readFileSync(this.dbPath);
    const encrypted = encryptBuffer(raw);

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    const filePath = path.join(this.backupDir, fileName);
    fs.writeFileSync(filePath, encrypted);

    const meta = {
      backupId,
      filePath,
      size: encrypted.length,
      keyId: readBackupKeyId(encrypted),
      createdAt: new Date().toISOString(),
    };

    if (this.s3 && this.s3Bucket) {
      await this._uploadToS3(fileName, encrypted);
      meta.s3Key = `${this.s3Prefix}${fileName}`;
      log.info('BACKUP', 'Backup uploaded to S3', { backupId, s3Key: meta.s3Key });
    }

    log.info('BACKUP', 'Backup completed', { backupId, size: meta.size });
    await this.verifyBackup(backupId);
    return meta;
  }

  /**
   * Verify a backup file is valid and restorable.
   *
   * Decrypts the backup to a temp file, opens it with SQLite, runs
   * PRAGMA integrity_check, and compares row counts for critical tables
   * against the source database.
   *
   * @param {string} backupId
   * @returns {Promise<{backupId: string, passed: boolean, checkedAt: string, details: object}>}
   */
  async verifyBackup(backupId) {
    const filePath = path.join(this.backupDir, `${backupId}.enc`);
    const checkedAt = new Date().toISOString();

    if (!fs.existsSync(filePath)) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    const encrypted = fs.readFileSync(filePath);
    const decrypted = decryptBuffer(encrypted);

    const tmpFile = path.join(os.tmpdir(), `verify_${backupId}_${Date.now()}.db`);
    let passed = false;
    let details = {};

    try {
      fs.writeFileSync(tmpFile, decrypted);

      try {
        const integrityResult = await this._runSqliteQuery(tmpFile, 'PRAGMA integrity_check');
        const integrityOk = integrityResult.length === 1 && integrityResult[0].integrity_check === 'ok';

        const CRITICAL_TABLES = ['users', 'transactions', 'recurring_donations'];
        const rowCounts = {};
        const sourceRowCounts = {};
        const rowCountMismatches = [];

        for (const table of CRITICAL_TABLES) {
          const [backupCount, sourceCount] = await Promise.all([
            this._getRowCount(tmpFile, table),
            this._getRowCount(this.dbPath, table),
          ]);
          rowCounts[table] = backupCount;
          sourceRowCounts[table] = sourceCount;
          if (backupCount !== sourceCount) {
            rowCountMismatches.push({ table, backup: backupCount, source: sourceCount });
          }
        }

        passed = integrityOk && rowCountMismatches.length === 0;
        details = { integrityOk, rowCounts, sourceRowCounts, rowCountMismatches };
      } catch (sqliteErr) {
        passed = false;
        details = { error: sqliteErr.message };
      }
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }

    const verification = { backupId, passed, checkedAt, details };
    this.lastVerification = verification;

    if (passed) {
      log.info('BACKUP', 'Backup verification passed', { backupId });
    } else {
      log.error('BACKUP', 'Backup verification FAILED', { backupId, details });
    }

    return verification;
  }

  /**
   * Run a SQLite query and return all rows.
   * @param {string} dbFile
   * @param {string} sql
   * @returns {Promise<object[]>}
   * @private
   */
  _runSqliteQuery(dbFile, sql) {
    return new Promise((resolve, reject) => {
      const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, err => {
        if (err) return reject(err);
      });
      db.all(sql, [], (err, rows) => {
        db.close();
        if (err) return reject(err);
        resolve(rows);
      });
    });
  }

  /**
   * Get row count for a table, returning 0 if the table doesn't exist.
   * @param {string} dbFile
   * @param {string} table
   * @returns {Promise<number>}
   * @private
   */
  async _getRowCount(dbFile, table) {
    if (!fs.existsSync(dbFile)) return 0;
    try {
      const rows = await this._runSqliteQuery(dbFile, `SELECT COUNT(*) as count FROM "${table}"`);
      return rows[0] ? rows[0].count : 0;
    } catch (_) {
      return 0;
    }
  }

  /**
   * Restore the database from a backup file.
   *
   * Decrypts the backup and atomically replaces the current database file.
   * The current database is preserved as a `.pre-restore` file for safety.
   *
   * @param {string} backupId - The backup ID (filename without .enc extension)
   * @returns {Promise<{backupId: string, restoredAt: string}>}
   */
  async restore(backupId) {
    log.info('BACKUP', 'Starting database restore', { backupId });

    // Reject backupId values that contain path separators or traversal sequences
    if (typeof backupId !== 'string' || !/^[\w.-]+$/.test(backupId)) {
      throw new Error(`Invalid backupId: ${backupId}`);
    }

    const resolvedDir = path.resolve(this.backupDir);
    const filePath = path.resolve(resolvedDir, `${backupId}.enc`);

    // Containment check: resolved path must stay within backupDir
    if (!filePath.startsWith(resolvedDir + path.sep) && filePath !== resolvedDir) {
      throw new Error(`Path traversal detected in backupId: ${backupId}`);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error(`Backup not found: ${backupId}`);
    }

    const encrypted = fs.readFileSync(filePath);
    const decrypted = decryptBuffer(encrypted);

    // Atomically replace: write to temp, rename
    const tmpPath = `${this.dbPath}.restore-tmp`;
    const prePath = `${this.dbPath}.pre-restore`;

    fs.writeFileSync(tmpPath, decrypted);

    if (fs.existsSync(this.dbPath)) {
      fs.renameSync(this.dbPath, prePath);
    }

    fs.renameSync(tmpPath, this.dbPath);

    const result = { backupId, keyId: readBackupKeyId(encrypted), restoredAt: new Date().toISOString() };
    log.info('BACKUP', 'Database restore completed', result);
    return result;
  }

  /**
   * Resolve a backupId to its encrypted file path inside the backup directory.
   * Returns null for IDs containing path separators or traversal sequences.
   *
   * @param {string} backupId
   * @returns {string|null}
   */
  resolveBackupPath(backupId) {
    if (typeof backupId !== 'string' || !/^[\w.-]+$/.test(backupId)) return null;
    const resolvedDir = path.resolve(this.backupDir);
    const filePath = path.resolve(resolvedDir, `${backupId}.enc`);
    if (!filePath.startsWith(resolvedDir + path.sep)) return null;
    return filePath;
  }

  /**
   * Check whether a local backup with the given ID exists.
   *
   * @param {string} backupId
   * @returns {Promise<boolean>}
   */
  async hasBackup(backupId) {
    const filePath = this.resolveBackupPath(backupId);
    return Boolean(filePath && fs.existsSync(filePath));
  }

  /**
   * List all available local backups sorted by creation time (newest first).
   *
   * @returns {Promise<Array<{backupId: string, filePath: string, size: number, createdAt: string}>>}
   */
  async listBackups() {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    const files = fs.readdirSync(this.backupDir)
      .filter(f => f.endsWith('.enc'));

    return files
      .map(f => {
        const filePath = path.join(this.backupDir, f);
        const stat = fs.statSync(filePath);
        return {
          backupId: f.replace('.enc', ''),
          filePath,
          size: stat.size,
          createdAt: stat.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Upload encrypted backup buffer to S3-compatible storage.
   * @param {string} fileName
   * @param {Buffer} data
   * @returns {Promise<void>}
   * @private
   */
  async _uploadToS3(fileName, data) {
    const key = `${this.s3Prefix}${fileName}`;
    // Compatible with AWS SDK v3 S3Client.send(new PutObjectCommand(...))
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await this.s3.send(new PutObjectCommand({
      Bucket: this.s3Bucket,
      Key: key,
      Body: data,
      ContentType: 'application/octet-stream',
    }));
  }
}

module.exports = BackupService;
