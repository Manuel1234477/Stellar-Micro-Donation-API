/**
 * Mock Transaction Manager
 * Manages transaction operations (send, verify, history)
 */

const crypto = require('crypto');
const { NotFoundError, ValidationError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');

class MockTransactionManager {
  constructor(config = {}) {
    this.transactions = new Map(); // publicKey -> [transactions]
    this.config = {
      baseReserve: config.baseReserve || '1.0000000',
      minAccountBalance: config.minAccountBalance || '1.0000000',
    };
  }

  /**
   * Create and record a transaction
   * @param {Object} params - Transaction parameters
   * @returns {Object} Transaction record
   */
  createTransaction(params) {
    const {
      sourcePublicKey,
      destinationPublic,
      amount,
      memo = '',
      sequence,
    } = params;

    const transaction = {
      transactionId: 'mock_' + crypto.randomBytes(16).toString('hex'),
      source: sourcePublicKey,
      destination: destinationPublic,
      amount: parseFloat(amount).toFixed(7),
      memo,
      timestamp: new Date().toISOString(),
      ledger: Math.floor(Math.random() * 1000000) + 1000000,
      status: 'confirmed',
      confirmedAt: new Date().toISOString(),
      fee: '0.0000100',
      sequence,
    };

    // Store transaction for both accounts
    if (!this.transactions.has(sourcePublicKey)) {
      this.transactions.set(sourcePublicKey, []);
    }
    if (!this.transactions.has(destinationPublic)) {
      this.transactions.set(destinationPublic, []);
    }

    this.transactions.get(sourcePublicKey).push(transaction);
    this.transactions.get(destinationPublic).push(transaction);

    return transaction;
  }

  /**
   * Get transaction history for an account
   * @param {string} publicKey - Account public key
   * @param {number} limit - Number of transactions to retrieve
   * @returns {Array} Transaction history
   */
  getHistory(publicKey, limit = 10) {
    const transactions = this.transactions.get(publicKey) || [];
    return transactions.slice(-limit).reverse();
  }

  /**
   * Verify a transaction by hash
   * @param {string} transactionHash - Transaction hash
   * @returns {Object} Verification result
   */
  verifyTransaction(transactionHash) {
    // Search all transactions for the given hash
    for (const txList of this.transactions.values()) {
      const transaction = txList.find(tx => tx.transactionId === transactionHash);
      if (transaction) {
        return {
          verified: true,
          status: transaction.status,
          transaction: {
            id: transaction.transactionId,
            source: transaction.source,
            destination: transaction.destination,
            amount: transaction.amount,
            memo: transaction.memo,
            timestamp: transaction.timestamp,
            ledger: transaction.ledger,
            status: transaction.status,
            confirmedAt: transaction.confirmedAt,
            fee: transaction.fee,
            sequence: transaction.sequence,
          },
        };
      }
    }

    throw new NotFoundError(
      `Transaction not found. The transaction ${transactionHash} does not exist on the network.`,
      ERROR_CODES.TRANSACTION_NOT_FOUND
    );
  }

  /**
   * Validate transaction parameters
   * @param {Object} params - Transaction parameters
   * @param {Object} sourceWallet - Source wallet
   * @param {Object} destWallet - Destination wallet
   * @throws {Error} If validation fails
   */
  validateTransaction(params, sourceWallet, destWallet) {
    const { sourcePublicKey, destinationPublic, amount } = params;

    if (!sourceWallet) {
      throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
    }

    if (sourcePublicKey === destinationPublic) {
      throw new ValidationError('Source and destination accounts cannot be the same.');
    }

    if (!destWallet) {
      throw new NotFoundError(
        `Destination account not found. The account ${destinationPublic} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }

    // Check if destination account is funded
    const destBalance = parseFloat(destWallet.balance);
    const minBalance = parseFloat(this.config.minAccountBalance);
    if (destBalance < minBalance) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Destination account is not funded. Stellar requires accounts to maintain a minimum balance of ${this.config.minAccountBalance} XLM. ` +
        'Please fund the account first using Friendbot (testnet) or send an initial funding transaction.'
      );
    }

    // Check for sufficient balance
    const amountNum = parseFloat(amount);
    const sourceBalance = parseFloat(sourceWallet.balance);
    const baseReserve = parseFloat(this.config.baseReserve);
    
    if (sourceBalance - amountNum < baseReserve) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Insufficient balance. Account must maintain minimum balance of ${this.config.baseReserve} XLM. ` +
        `Available: ${sourceBalance} XLM, Required: ${amountNum + baseReserve} XLM (${amountNum} + ${baseReserve} reserve)`
      );
    }
  }

  /**
   * Get all transactions (for testing)
   * @returns {Object}
   */
  getAllTransactions() {
    return Object.fromEntries(this.transactions);
  }

  /**
   * Clear all transactions (for testing)
   */
  clearAll() {
    this.transactions.clear();
  }
}

module.exports = MockTransactionManager;
