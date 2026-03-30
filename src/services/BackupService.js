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
const log = require('../utils/log');

const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '../../data/backups');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Derive a 32-byte key from the ENCRYPTION_KEY env var (same approach as encryption.js).
 * @returns {Buffer}
 */
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is required for backup encryption');
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encrypt a Buffer using AES-256-GCM.
 * @param {Buffer} data
 * @returns {Buffer} iv (12) + authTag (16) + ciphertext
 */
function encryptBuffer(data) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

/**
 * Decrypt a Buffer produced by encryptBuffer.
 * @param {Buffer} data
 * @returns {Buffer}
 */
function decryptBuffer(data) {
  const iv = data.slice(0, IV_LENGTH);
  const tag = data.slice(IV_LENGTH, IV_LENGTH + 16);
  const ct = data.slice(IV_LENGTH + 16);
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
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
      createdAt: new Date().toISOString(),
    };

    if (this.s3 && this.s3Bucket) {
      await this._uploadToS3(fileName, encrypted);
      meta.s3Key = `${this.s3Prefix}${fileName}`;
      log.info('BACKUP', 'Backup uploaded to S3', { backupId, s3Key: meta.s3Key });
    }

    log.info('BACKUP', 'Backup completed', { backupId, size: meta.size });
    return meta;
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

    const filePath = path.join(this.backupDir, `${backupId}.enc`);

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

    const result = { backupId, restoredAt: new Date().toISOString() };
    log.info('BACKUP', 'Database restore completed', result);
    return result;
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
