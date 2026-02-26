/**
 * Transaction Builder - Test Data Builder
 * 
 * RESPONSIBILITY: Simplifies transaction mock data creation for tests
 * OWNER: QA/Testing Team
 * 
 * Provides fluent API for building transaction objects with sensible defaults.
 */

class TransactionBuilder {
  constructor() {
    this.data = {
      id: this._generateId(),
      amount: 100,
      donor: 'GDONOR' + 'A'.repeat(50),
      recipient: 'GRECIPIENT' + 'A'.repeat(45),
      timestamp: new Date().toISOString(),
      status: 'completed',
      memo: null
    };
  }

  /**
   * Set transaction ID
   * @param {string} id
   * @returns {TransactionBuilder}
   */
  withId(id) {
    this.data.id = id;
    return this;
  }

  /**
   * Set transaction amount
   * @param {number} amount
   * @returns {TransactionBuilder}
   */
  withAmount(amount) {
    this.data.amount = amount;
    return this;
  }

  /**
   * Set donor address
   * @param {string} donor
   * @returns {TransactionBuilder}
   */
  withDonor(donor) {
    this.data.donor = donor;
    return this;
  }

  /**
   * Set recipient address
   * @param {string} recipient
   * @returns {TransactionBuilder}
   */
  withRecipient(recipient) {
    this.data.recipient = recipient;
    return this;
  }

  /**
   * Set transaction timestamp
   * @param {string|Date} timestamp
   * @returns {TransactionBuilder}
   */
  withTimestamp(timestamp) {
    this.data.timestamp = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
    return this;
  }

  /**
   * Set transaction status
   * @param {string} status
   * @returns {TransactionBuilder}
   */
  withStatus(status) {
    this.data.status = status;
    return this;
  }

  /**
   * Set memo
   * @param {string} memo
   * @returns {TransactionBuilder}
   */
  withMemo(memo) {
    this.data.memo = memo;
    return this;
  }

  /**
   * Set donor from wallet object
   * @param {Object} wallet
   * @returns {TransactionBuilder}
   */
  fromWallet(wallet) {
    this.data.donor = wallet.publicKey;
    return this;
  }

  /**
   * Set recipient from wallet object
   * @param {Object} wallet
   * @returns {TransactionBuilder}
   */
  toWallet(wallet) {
    this.data.recipient = wallet.publicKey;
    return this;
  }

  /**
   * Set transaction as completed
   * @returns {TransactionBuilder}
   */
  completed() {
    this.data.status = 'completed';
    return this;
  }

  /**
   * Set transaction as pending
   * @returns {TransactionBuilder}
   */
  pending() {
    this.data.status = 'pending';
    return this;
  }

  /**
   * Set transaction as failed
   * @returns {TransactionBuilder}
   */
  failed() {
    this.data.status = 'failed';
    return this;
  }

  /**
   * Build and return the transaction object
   * @returns {Object}
   */
  build() {
    const result = { ...this.data };
    // Remove null values
    Object.keys(result).forEach(key => {
      if (result[key] === null) {
        delete result[key];
      }
    });
    return result;
  }

  /**
   * Build multiple transactions with incremental IDs
   * @param {number} count
   * @returns {Array<Object>}
   */
  buildMany(count) {
    const transactions = [];
    for (let i = 0; i < count; i++) {
      const tx = this.build();
      tx.id = `${tx.id}-${i}`;
      transactions.push(tx);
    }
    return transactions;
  }

  /**
   * Generate a unique transaction ID
   * @private
   */
  _generateId() {
    return `tx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create a completed transaction
   * @param {string} donor
   * @param {string} recipient
   * @param {number} amount
   * @returns {Object}
   */
  static completed(donor, recipient, amount = 100) {
    return new TransactionBuilder()
      .withDonor(donor)
      .withRecipient(recipient)
      .withAmount(amount)
      .completed()
      .build();
  }

  /**
   * Create a pending transaction
   * @param {string} donor
   * @param {string} recipient
   * @param {number} amount
   * @returns {Object}
   */
  static pending(donor, recipient, amount = 100) {
    return new TransactionBuilder()
      .withDonor(donor)
      .withRecipient(recipient)
      .withAmount(amount)
      .pending()
      .build();
  }

  /**
   * Create multiple transactions for a wallet
   * @param {string} walletAddress
   * @param {number} count
   * @param {Object} options - { asDonor: boolean, asRecipient: boolean }
   * @returns {Array<Object>}
   */
  static forWallet(walletAddress, count = 3, options = {}) {
    const { asDonor = true, asRecipient = true } = options;
    const transactions = [];

    for (let i = 0; i < count; i++) {
      const builder = new TransactionBuilder().withAmount(100 + i * 10);
      
      if (asDonor && (!asRecipient || i % 2 === 0)) {
        builder.withDonor(walletAddress);
      } else {
        builder.withRecipient(walletAddress);
      }
      
      transactions.push(builder.build());
    }

    return transactions;
  }
}

module.exports = TransactionBuilder;
