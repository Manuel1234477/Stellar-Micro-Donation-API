const fs = require('fs');
const path = require('path');

const WALLETS_DB_PATH = './data/wallets.json';

/** Encrypted field names on wallet records */
const ENCRYPTED_FIELDS = ['label', 'notes'];

function getEncryptionService() {
  // Lazy-require to avoid circular deps and allow tests to override env
  return require('../../services/EncryptionService');
}

function encryptWalletFields(wallet) {
  if (!process.env.ENCRYPTION_KEY && !process.env.ENCRYPTION_KEY_1) return wallet;
  const svc = getEncryptionService();
  const result = { ...wallet };
  for (const field of ENCRYPTED_FIELDS) {
    if (result[field] != null) {
      result[field] = svc.encryptField(result[field]);
    }
  }
  return result;
}

function decryptWalletFields(wallet) {
  if (!wallet) return wallet;
  const svc = getEncryptionService();
  const result = { ...wallet };
  for (const field of ENCRYPTED_FIELDS) {
    if (result[field] != null) {
      try { result[field] = svc.decryptField(result[field]); } catch (_) { /* leave as-is */ }
    }
  }
  return result;
}

class Wallet {
  static ensureDbDir() {
    const dir = path.dirname(WALLETS_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static loadWallets() {
    this.ensureDbDir();
    if (!fs.existsSync(WALLETS_DB_PATH)) {
      return [];
    }
    try {
      const data = fs.readFileSync(WALLETS_DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  static saveWallets(wallets) {
    this.ensureDbDir();
    fs.writeFileSync(WALLETS_DB_PATH, JSON.stringify(wallets, null, 2));
  }

  static create(walletData) {
    const wallets = this.loadWallets();
    const newWallet = {
      id: Date.now().toString(),
      address: walletData.address,
      label: walletData.label || null,
      ownerName: walletData.ownerName || null,
      createdAt: new Date().toISOString(),
      deletedAt: null, // Initialized for soft-delete support
      last_synced_at: null,
      last_cursor: null,
      ...walletData
    };
    wallets.push(encryptWalletFields(newWallet));
    this.saveWallets(wallets);
    return newWallet;
  }

  /**
   * Returns only wallets that have NOT been soft-deleted
   */
  static getAll() {
    const wallets = this.loadWallets();
    return wallets.filter(w => !w.deletedAt).map(decryptWalletFields);
  }

  /**
   * Returns a specific wallet only if not soft-deleted
   */
  static getById(id) {
    const wallets = this.loadWallets();
    return decryptWalletFields(wallets.find(w => w.id === id && !w.deletedAt));
  }

  /**
   * Returns a specific address only if not soft-deleted
   */
  static getByAddress(address) {
    const wallets = this.loadWallets();
    return decryptWalletFields(wallets.find(w => w.address === address && !w.deletedAt));
  }

  /**
   * Internal method for admin/cleanup to see deleted records
   */
  static getAllDeleted() {
    const wallets = this.loadWallets();
    return wallets.filter(w => !!w.deletedAt);
  }

  static update(id, updates) {
    const wallets = this.loadWallets();
    const index = wallets.findIndex(w => w.id === id && !w.deletedAt);
    if (index === -1) return null;

    wallets[index] = encryptWalletFields({
      ...wallets[index],
      ...updates,
      updatedAt: new Date().toISOString()
    });
    this.saveWallets(wallets);
    return decryptWalletFields(wallets[index]);
  }

  /**
   * Soft delete: sets the deletedAt timestamp instead of removing from array
   */
  static softDelete(id) {
    const wallets = this.loadWallets();
    const index = wallets.findIndex(w => w.id === id);
    if (index === -1) return false;

    wallets[index].deletedAt = new Date().toISOString();
    this.saveWallets(wallets);
    return true;
  }
}

module.exports = Wallet;
module.exports.ENCRYPTED_FIELDS = ENCRYPTED_FIELDS;
module.exports.encryptWalletFields = encryptWalletFields;
module.exports.decryptWalletFields = decryptWalletFields;