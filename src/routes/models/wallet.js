const fs = require('fs');
const path = require('path');

const WALLETS_DB_PATH = './data/wallets.json';

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
      ...walletData
    };
    wallets.push(newWallet);
    this.saveWallets(wallets);
    return newWallet;
  }

  /**
   * Returns only wallets that have NOT been soft-deleted
   */
  static getAll() {
    const wallets = this.loadWallets();
    return wallets.filter(w => !w.deletedAt);
  }

  /**
   * Returns a specific wallet only if not soft-deleted
   */
  static getById(id) {
    const wallets = this.loadWallets();
    return wallets.find(w => w.id === id && !w.deletedAt);
  }

  /**
   * Returns a specific address only if not soft-deleted
   */
  static getByAddress(address) {
    const wallets = this.loadWallets();
    return wallets.find(w => w.address === address && !w.deletedAt);
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

    wallets[index] = {
      ...wallets[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.saveWallets(wallets);
    return wallets[index];
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