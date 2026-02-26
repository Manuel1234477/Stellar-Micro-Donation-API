class StellarServiceInterface {
  async loadAccount(publicKey) {
    throw new Error('loadAccount() must be implemented');
  }

  async submitTransaction(transaction) {
    throw new Error('submitTransaction() must be implemented');
  }

  async buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options = {}) {
    throw new Error('buildPaymentTransaction() must be implemented');
  }

  async getAccountSequence(publicKey) {
    throw new Error('getAccountSequence() must be implemented');
  }

  async buildTransaction(sourcePublicKey, operations, options = {}) {
    throw new Error('buildTransaction() must be implemented');
  }

  async signTransaction(transaction, secretKey) {
    throw new Error('signTransaction() must be implemented');
  }

  async getAccountBalances(publicKey) {
    throw new Error('getAccountBalances() must be implemented');
  }

  async getTransaction(transactionHash) {
    throw new Error('getTransaction() must be implemented');
  }

  isValidAddress(address) {
    throw new Error('isValidAddress() must be implemented');
  }

  stroopsToXlm(stroops) {
    throw new Error('stroopsToXlm() must be implemented');
  }

  xlmToStroops(xlm) {
    throw new Error('xlmToStroops() must be implemented');
  }

  getNetwork() {
    throw new Error('getNetwork() must be implemented');
  }

  getHorizonUrl() {
    throw new Error('getHorizonUrl() must be implemented');
  }
}

module.exports = StellarServiceInterface;
