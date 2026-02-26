/**
 * Wallet Service - Wallet Management Layer
 * 
 * RESPONSIBILITY: Wallet metadata management and transaction history queries
 * OWNER: Backend Team
 * DEPENDENCIES: Database, Wallet model, sanitizers
 * 
 * Handles business logic for wallet operations including creation, updates,
 * and transaction retrieval. Separates data access from HTTP controllers.
 */

const Wallet = require('../routes/models/wallet');
const Database = require('../utils/database');
const { sanitizeLabel, sanitizeName } = require('../utils/sanitizer');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');

class WalletService {
  /**
   * Create a new wallet with metadata
   * @param {Object} params - Wallet parameters
   * @param {string} params.address - Wallet address
   * @param {string} params.label - Optional wallet label
   * @param {string} params.ownerName - Optional owner name
   * @returns {Object} Created wallet
   * @throws {ValidationError} If address is missing or wallet already exists
   */
  createWallet({ address, label, ownerName }) {
    if (!address) {
      throw new ValidationError('Missing required field: address', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const existingWallet = Wallet.getByAddress(address);
    if (existingWallet) {
      throw new ValidationError(
        'Wallet with this address already exists',
        null,
        ERROR_CODES.DUPLICATE_WALLET
      );
    }

    // Sanitize user-provided metadata
    const sanitizedLabel = label ? sanitizeLabel(label) : null;
    const sanitizedOwnerName = ownerName ? sanitizeName(ownerName) : null;

    return Wallet.create({ 
      address, 
      label: sanitizedLabel, 
      ownerName: sanitizedOwnerName 
    });
  }

  /**
   * Get all wallets
   * @returns {Array} Array of wallet objects
   */
  getAllWallets() {
    return Wallet.getAll();
  }

  /**
   * Get wallet by ID
   * @param {string} id - Wallet ID
   * @returns {Object} Wallet object
   * @throws {NotFoundError} If wallet not found
   */
  getWalletById(id) {
    const wallet = Wallet.getById(id);
    
    if (!wallet) {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    return wallet;
  }

  /**
   * Get wallet by address
   * @param {string} address - Wallet address
   * @returns {Object|null} Wallet object or null if not found
   */
  getWalletByAddress(address) {
    return Wallet.getByAddress(address);
  }

  /**
   * Update wallet metadata
   * @param {string} id - Wallet ID
   * @param {Object} updates - Fields to update
   * @param {string} updates.label - Optional new label
   * @param {string} updates.ownerName - Optional new owner name
   * @returns {Object} Updated wallet
   * @throws {ValidationError} If no fields provided
   * @throws {NotFoundError} If wallet not found
   */
  updateWallet(id, { label, ownerName }) {
    if (label === undefined && ownerName === undefined) {
      throw new ValidationError(
        'At least one field (label or ownerName) is required',
        null,
        ERROR_CODES.MISSING_REQUIRED_FIELD
      );
    }

    // Sanitize user-provided metadata
    const updates = {};
    if (label !== undefined) updates.label = sanitizeLabel(label);
    if (ownerName !== undefined) updates.ownerName = sanitizeName(ownerName);

    const wallet = Wallet.update(id, updates);
    
    if (!wallet) {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    return wallet;
  }

  /**
   * Get user by public key
   * @param {string} publicKey - User's public key
   * @returns {Promise<Object|null>} User object or null if not found
   */
  async getUserByPublicKey(publicKey) {
    return await Database.get(
      'SELECT id, publicKey, createdAt FROM users WHERE publicKey = ?',
      [publicKey]
    );
  }

  /**
   * Get all transactions for a wallet (sent and received)
   * @param {string} publicKey - Wallet public key
   * @returns {Promise<Object>} Transactions data with count
   */
  async getWalletTransactions(publicKey) {
    // Check if user exists with this publicKey
    const user = await this.getUserByPublicKey(publicKey);

    if (!user) {
      // Return empty array if wallet doesn't exist
      return {
        transactions: [],
        count: 0,
        message: 'No user found with this public key'
      };
    }

    // Get all transactions where user is sender or receiver
    const transactions = await Database.query(
      `SELECT 
        t.id,
        t.senderId,
        t.receiverId,
        t.amount,
        t.memo,
        t.timestamp,
        sender.publicKey as senderPublicKey,
        receiver.publicKey as receiverPublicKey
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      LEFT JOIN users receiver ON t.receiverId = receiver.id
      WHERE t.senderId = ? OR t.receiverId = ?
      ORDER BY t.timestamp DESC`,
      [user.id, user.id]
    );

    // Format the response
    const formattedTransactions = transactions.map(tx => ({
      id: tx.id,
      sender: tx.senderPublicKey,
      receiver: tx.receiverPublicKey,
      amount: tx.amount,
      memo: tx.memo,
      timestamp: tx.timestamp
    }));

    return {
      transactions: formattedTransactions,
      count: formattedTransactions.length
    };
  }
}

module.exports = WalletService;
