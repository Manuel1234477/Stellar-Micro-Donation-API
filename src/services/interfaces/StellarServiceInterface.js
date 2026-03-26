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
}

module.exports = StellarServiceInterface;
