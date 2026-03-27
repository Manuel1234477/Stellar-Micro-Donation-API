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

  async setHomeDomain(_sourceSecret, _domain) {
    void _sourceSecret;
    void _domain;
    throw new Error('setHomeDomain() must be implemented');
  }

  async getHomeDomain(_publicKey) {
    void _publicKey;
    throw new Error('getHomeDomain() must be implemented');
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

  async mintCertificateNFT(_params) {
    void _params;
    throw new Error('mintCertificateNFT() must be implemented');
  }

  async getCertificatesForWallet(_publicKey) {
    void _publicKey;
    throw new Error('getCertificatesForWallet() must be implemented');
  async simulateTransaction(_xdr) {
    void _xdr;
    throw new Error('simulateTransaction() must be implemented');
  }
}

module.exports = StellarServiceInterface;
