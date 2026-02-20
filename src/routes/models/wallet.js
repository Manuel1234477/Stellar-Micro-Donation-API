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
      ...walletData
    };
    wallets.push(newWallet);
    this.saveWallets(wallets);
    return newWallet;
  }

  static getAll() {
    return this.loadWallets();
  }

  static getById(id) {
    const wallets = this.loadWallets();
    return wallets.find(w => w.id === id);
  }

  static getByAddress(address) {
    const wallets = this.loadWallets();
    return wallets.find(w => w.address === address);
  }

  static update(id, updates) {
    const wallets = this.loadWallets();
    const index = wallets.findIndex(w => w.id === id);
    if (index === -1) return null;
    
    wallets[index] = {
      ...wallets[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    this.saveWallets(wallets);
    return wallets[index];
  }
}

module.exports = Wallet;
