/**
 * User Model - Data Access Layer
 */

const users = require('../../../data/users.json');

class User {
  static getById(id) {
    if (!id) return null;
    return users.find(u => u.id === id) || null;
  }

  static getByWallet(address) {
    if (!address) return null;
    return users.find(u => u.wallet === address || u.publicKey === address) || null;
  }
}

module.exports = User;
