class StellarServiceInterface {
  async loadAccount(_publicKey) {
    void _publicKey;
    throw new Error('loadAccount() must be implemented');
  }

  async submitTransaction(_transaction) {
    void _transaction;
    throw new Error('submitTransaction() must be implemented');
  }

  async buildPaymentTransaction(_sourcePublicKey, _destinationPublicKey, _amount, _options = {}) {
    void _sourcePublicKey;
    void _destinationPublicKey;
    void _amount;
    void _options;
    throw new Error('buildPaymentTransaction() must be implemented');
  }

  async getAccountSequence(_publicKey) {
    void _publicKey;
    throw new Error('getAccountSequence() must be implemented');
  }

  async buildTransaction(_sourcePublicKey, _operations, _options = {}) {
    void _sourcePublicKey;
    void _operations;
    void _options;
    throw new Error('buildTransaction() must be implemented');
  }

  async signTransaction(_transaction, _secretKey) {
    void _transaction;
    void _secretKey;
    throw new Error('signTransaction() must be implemented');
  }

  async getAccountBalances(_publicKey) {
    void _publicKey;
    throw new Error('getAccountBalances() must be implemented');
  }

  async getTransaction(_transactionHash) {
    void _transactionHash;
    throw new Error('getTransaction() must be implemented');
  }

  async buildAndSubmitFeeBumpTransaction(envelopeXdr, newFeeStroops, feeSourceSecret) {
    throw new Error('buildAndSubmitFeeBumpTransaction() must be implemented');
  }

  /**
   * Bump an account's sequence number to a specific value.
   * Useful for invalidating pre-signed transactions (time-locked escrow, etc.).
   * @param {string} secret - Secret key of the account to bump
   * @param {string|number} bumpTo - Target sequence number (must be > current)
   * @returns {Promise<{hash: string, ledger: number, newSequence: string}>}
   */
  async bumpSequence(_secret, _bumpTo) {
    void _secret;
    void _bumpTo;
    throw new Error('bumpSequence() must be implemented');
  }

  isValidAddress(address) {
    void address;
    throw new Error('isValidAddress() must be implemented');
  }

  async discoverBestPath(_params) {
    void _params;
    throw new Error('discoverBestPath() must be implemented');
  }

  async pathPayment(sourceAsset, sourceAmount, destAsset, destAmount, path, options = {}) {
    void sourceAsset;
    void sourceAmount;
    void destAsset;
    void destAmount;
    void path;
    void options;
    throw new Error('pathPayment() must be implemented');
  }

  isValidAddress(_address) {
    void _address;
    throw new Error('isValidAddress() must be implemented');
  }

  stroopsToXlm(_stroops) {
    void _stroops;
    throw new Error('stroopsToXlm() must be implemented');
  }

  xlmToStroops(_xlm) {
    void _xlm;
    throw new Error('xlmToStroops() must be implemented');
  }

  getNetwork() {
    throw new Error('getNetwork() must be implemented');
  }

  getHorizonUrl() {
    throw new Error('getHorizonUrl() must be implemented');
  }

  async estimateFee(_operationCount = 1) {
    void _operationCount;
    throw new Error('estimateFee() must be implemented');
  }

  async setInflationDestination(_sourceSecret, _destinationPublicKey) {
    void _sourceSecret;
    void _destinationPublicKey;
    throw new Error('setInflationDestination() must be implemented');
  }

  async getInflationDestination(_publicKey) {
    void _publicKey;
    throw new Error('getInflationDestination() must be implemented');
  }

  async setAccountData(_secret, _key, _value) {
    void _secret;
    void _key;
    void _value;
    throw new Error('setAccountData() must be implemented');
  }

  async deleteAccountData(_secret, _key) {
    void _secret;
    void _key;
    throw new Error('deleteAccountData() must be implemented');
  }

  /**
   * Set account options (home domain, thresholds, signers, flags).
   * @param {string} _secret - Account secret key
   * @param {object} _options - Stellar setOptions fields
   */
  async setOptions(_secret, _options) {
    void _secret;
    void _options;
    throw new Error('setOptions() must be implemented');
  }

  /**
   * Clawback a custom asset from a holder.
   * @param {string} _issuerSecret - Issuer secret key
   * @param {string} _from         - Holder public key
   * @param {string} _assetCode    - Asset code
   * @param {string} _amount       - Amount to clawback
   */
  async clawback(_issuerSecret, _from, _assetCode, _amount) {
    void _issuerSecret;
    void _from;
    void _assetCode;
    void _amount;
    throw new Error('clawback() must be implemented');
  }

  /**
   * Add a trustline for an asset to an account.
   * @param {string} _publicKey - Account public key
   * @param {Object} _asset - Asset object with code and issuer
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async addTrustline(_publicKey, _asset) {
    void _publicKey;
    void _asset;
    throw new Error('addTrustline() must be implemented');
  }

  /**
   * Remove a trustline for an asset from an account.
   * @param {string} _publicKey - Account public key
   * @param {Object} _asset - Asset object with code and issuer
   * @returns {Promise<{hash: string, ledger: number}>}
   */
  async removeTrustline(_publicKey, _asset) {
    void _publicKey;
    void _asset;
    throw new Error('removeTrustline() must be implemented');
  }

  /**
   * Get all trustlines for an account with their balances.
   * @param {string} _publicKey - Account public key
   * @returns {Promise<Array<{asset: Object, balance: string, limit: string}>>}
   */
  async getTrustlines(_publicKey) {
    void _publicKey;
    throw new Error('getTrustlines() must be implemented');
  }

  /**
   * Execute a strict-send path payment: send exactly sendAmount of sendAsset,
   * receive at least minDestAmount of destAsset.
   * @param {string} _sourceSecret
   * @param {Object} _sendAsset
   * @param {string} _sendAmount
   * @param {string} _destPublicKey
   * @param {Object} _destAsset
   * @param {string} _minDestAmount
   * @param {Object} [_options]
   * @returns {Promise<Object>}
   */
  async pathPaymentStrictSend(_sourceSecret, _sendAsset, _sendAmount, _destPublicKey, _destAsset, _minDestAmount, _options = {}) {
    void _sourceSecret; void _sendAsset; void _sendAmount;
    void _destPublicKey; void _destAsset; void _minDestAmount; void _options;
    throw new Error('pathPaymentStrictSend() must be implemented');
  }

  /**
   * Execute a strict-receive path payment: receive exactly destAmount of destAsset,
   * spend at most maxSendAmount of sendAsset.
   * @param {string} _sourceSecret
   * @param {Object} _sendAsset
   * @param {string} _maxSendAmount
   * @param {string} _destPublicKey
   * @param {Object} _destAsset
   * @param {string} _destAmount
   * @param {Object} [_options]
   * @returns {Promise<Object>}
   */
  async pathPaymentStrictReceive(_sourceSecret, _sendAsset, _maxSendAmount, _destPublicKey, _destAsset, _destAmount, _options = {}) {
    void _sourceSecret; void _sendAsset; void _maxSendAmount;
    void _destPublicKey; void _destAsset; void _destAmount; void _options;
    throw new Error('pathPaymentStrictReceive() must be implemented');
  }

  /**
   * Find available DEX conversion paths between two assets.
   * @param {string} _sourcePublicKey
   * @param {string} _destPublicKey
   * @param {Object} _destAsset
   * @param {string} _destAmount
   * @returns {Promise<Array<Object>>}
   */
  async findPaymentPaths(_sourcePublicKey, _destPublicKey, _destAsset, _destAmount) {
    void _sourcePublicKey; void _destPublicKey; void _destAsset; void _destAmount;
    throw new Error('findPaymentPaths() must be implemented');
  }
}

module.exports = StellarServiceInterface;
