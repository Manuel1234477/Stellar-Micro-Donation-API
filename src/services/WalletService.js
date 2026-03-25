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
const { sanitizeLabel, sanitizeName, sanitizeStellarAddress } = require('../utils/sanitizer');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const { paginateCollection } = require('../utils/pagination');
const log = require('../utils/log');

class WalletService {
  constructor(stellarService = null) {
    this.stellarService = stellarService;
  }

  /**
   * Create a new wallet with metadata.
   * On testnet, automatically funds the new account via Friendbot.
   * If sponsored=true and SPONSOR_SECRET is configured, uses platform sponsorship
   * so the new account requires no XLM for base reserve.
   * @param {Object} params
   * @param {string} params.address - Wallet address (Stellar public key)
   * @param {string} [params.label]
   * @param {string} [params.ownerName]
   * @param {boolean} [params.sponsored=false] - Create via platform sponsorship
   * @returns {Promise<Object>} Created wallet with `funded` and `sponsored` fields
   */
  async createWallet({ address, label, ownerName, sponsored = false }) {
    if (!address) {
      throw new ValidationError('Missing required field: address', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    // Sanitize wallet address to prevent injection attacks
    const sanitizedAddress = sanitizeStellarAddress(address);

    const existingWallet = Wallet.getByAddress(sanitizedAddress);
    if (existingWallet) {
      throw new ValidationError(
        'Wallet with this address already exists',
        null,
        ERROR_CODES.DUPLICATE_WALLET
      );
    }

    const sanitizedLabel = label ? sanitizeLabel(label) : null;
    const sanitizedOwnerName = ownerName ? sanitizeName(ownerName) : null;

    const wallet = Wallet.create({
      address: sanitizedAddress,
      label: sanitizedLabel,
      ownerName: sanitizedOwnerName
    });

    // Auto-fund on testnet via Friendbot, or use platform sponsorship
    let funded = false;
    let isSponsored = false;
    if (this.stellarService) {
      if (sponsored && process.env.SPONSOR_SECRET) {
        try {
          await this.stellarService.createSponsoredAccount(process.env.SPONSOR_SECRET, address);
          isSponsored = true;
          funded = true;
        } catch (err) {
          log.warn('WALLET_SERVICE', 'Sponsored account creation failed, falling back to Friendbot', {
            address, error: err.message
          });
        }
      }
      if (!isSponsored) {
        const fundResult = await this.stellarService.fundWithFriendbot(address);
        funded = fundResult.funded;
        if (!funded) {
          log.warn('WALLET_SERVICE', 'Friendbot funding skipped or failed', {
            address,
            reason: fundResult.error || 'non-testnet network'
          });
        }
      }
    }

    return { ...wallet, funded, sponsored: isSponsored };
  }

  /**
   * Get all wallets
   * @returns {Array} Array of wallet objects
   */
  getAllWallets() {
    return Wallet.getAll();
  }

  /**
   * Get wallets using cursor-based pagination.
   * @param {Object} pagination - Pagination options.
   * @param {{ timestamp: string, id: string }|null} pagination.cursor - Decoded cursor.
   * @param {number} pagination.limit - Page size.
   * @param {string} pagination.direction - Pagination direction.
   * @returns {{ data: Array, totalCount: number, meta: Object }} Paginated wallets.
   */
  getPaginatedWallets(pagination) {
    return paginateCollection(Wallet.getAll(), {
      ...pagination,
      timestampField: 'createdAt',
      idField: 'id',
    });
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
  /**
   * Get wallet balance with caching support
   * @param {string} id - Wallet ID
   * @param {boolean} forceRefresh - Bypass cache request
   * @returns {Promise<Object>} Balance data with cache meta
   */
  async getBalance(id, forceRefresh = false) {
    const wallet = this.getWalletById(id);
    const cacheKey = `wallet_balance_${wallet.address}`;
    const cacheTtl = parseInt(process.env.WALLET_BALANCE_CACHE_TTL, 10) || 30000;
    
    const Cache = require('../utils/cache');
    const serviceContainer = require('../config/serviceContainer');
    const stellarService = serviceContainer.getStellarService();

    if (!forceRefresh) {
      const cached = Cache.get(cacheKey);
      if (cached !== null) {
         return { ...cached, cached: true };
      }
    }

    const liveBalance = await stellarService.getBalance(wallet.address);
    Cache.set(cacheKey, liveBalance, cacheTtl);

    return { ...liveBalance, cached: false };
  }
  /**
   * Revoke platform sponsorship for a wallet.
   * Requires SPONSOR_SECRET to be configured.
   * @param {string} id - Wallet ID
   * @returns {Promise<Object>} Result with revoked flag and transactionId
   * @throws {ValidationError} If SPONSOR_SECRET is not configured
   * @throws {NotFoundError} If wallet not found
   */
  async revokeSponsoredAccount(id) {
    const wallet = this.getWalletById(id);

    if (!process.env.SPONSOR_SECRET) {
      throw new ValidationError('SPONSOR_SECRET is not configured', null, ERROR_CODES.INVALID_REQUEST);
    }
    if (!this.stellarService) {
      throw new ValidationError('Stellar service not available', null, ERROR_CODES.SERVICE_UNAVAILABLE);
    }

    const result = await this.stellarService.revokeSponsoredAccount(
      process.env.SPONSOR_SECRET,
      wallet.address
    );

    Wallet.update(id, { sponsored: false, sponsorshipRevokedAt: new Date().toISOString() });

    return result;
  }
}

module.exports = WalletService;
