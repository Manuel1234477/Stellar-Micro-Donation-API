/**
 * Real Stellar Service
 * Handles actual blockchain interactions with Stellar network
 */

const StellarSdk = require('stellar-sdk');

class StellarService {
  constructor(config = {}) {
    this.network = config.network || 'testnet';
    this.horizonUrl = config.horizonUrl || 'https://horizon-testnet.stellar.org';
    this.serviceSecretKey = config.serviceSecretKey;

    this.server = new StellarSdk.Horizon.Server(this.horizonUrl);
  }

  /**
   * Create a new Stellar wallet
   * @returns {Promise<{publicKey: string, secretKey: string}>}
   */
  async createWallet() {
    const pair = StellarSdk.Keypair.random();
    return {
      publicKey: pair.publicKey(),
      secretKey: pair.secret(),
    };
  }

  /**
   * Get wallet balance
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string, asset: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async getBalance(publicKey) {
    try {
      const account = await this.server.loadAccount(publicKey);
      const nativeBalance = account.balances.find(b => b.asset_type === 'native');
      return {
        balance: nativeBalance ? nativeBalance.balance : '0',
        asset: 'XLM',
      };
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return { balance: '0', asset: 'XLM' };
      }
      throw error;
    }
  }

  /**
   * Fund a testnet wallet via Friendbot
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{balance: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async fundTestnetWallet(publicKey) {
    try {
      await this.server.friendbot(publicKey).call();
      const balance = await this.getBalance(publicKey);
      return balance;
    } catch (error) {
      throw new Error(`Failed to fund wallet: ${error.message}`);
    }
  }

  /**
   * Check if an account is funded on Stellar
   * @param {string} publicKey - Stellar public key
   * @returns {Promise<{funded: boolean, balance: string, exists: boolean}>}
   */
  // eslint-disable-next-line no-unused-vars
  async isAccountFunded(publicKey) {
    try {
      const balance = await this.getBalance(publicKey);
      const funded = parseFloat(balance.balance) > 0;
      return {
        funded,
        balance: balance.balance,
        exists: true,
      };
    } catch (error) {
      return {
        funded: false,
        balance: '0',
        exists: false,
      };
    }
  }

  /**
   * Send a donation transaction
   * @param {Object} params
   * @param {string} params.sourceSecret - Source account secret key
   * @param {string} params.destinationPublic - Destination public key
   * @param {string} params.amount - Amount in XLM
   * @param {string} [params.memo] - Optional transaction memo (max 28 bytes)
   * @returns {Promise<{transactionId: string, ledger: number}>}
   */
  async sendDonation({ sourceSecret, destinationPublic, amount, memo = '' }) {
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.server.loadAccount(sourceKeypair.publicKey());

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.network === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: destinationPublic,
          asset: StellarSdk.Asset.native(),
          amount: amount.toString(),
        }))
        .setTimeout(30);

      if (memo) {
        transaction.addMemo(StellarSdk.Memo.text(memo));
      }

      const builtTx = transaction.build();
      builtTx.sign(sourceKeypair);

      const result = await this.server.submitTransaction(builtTx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
      };
    } catch (error) {
      console.error('Stellar transaction error:', error);
      const message = error.response?.data?.extras?.result_codes?.operations?.[0] || error.message;
      throw new Error(`Stellar transaction failed: ${message}`);
    }
  }

  /**
   * Get transaction history for an account
   * @param {string} publicKey - Stellar public key
   * @param {number} limit - Number of transactions to retrieve
   * @returns {Promise<Array>}
   */
  // eslint-disable-next-line no-unused-vars
  async getTransactionHistory(publicKey, limit = 10) {
    try {
      const result = await this.server.transactions()
        .forAccount(publicKey)
        .limit(limit)
        .order('desc')
        .call();
      return result.records;
    } catch (error) {
      throw new Error(`Failed to fetch transactions: ${error.message}`);
    }
  }

  /**
   * Stream transactions for an account
   * @param {string} publicKey - Stellar public key
   * @param {Function} onTransaction - Callback for each transaction
   * @returns {Function} Unsubscribe function
   */
  // eslint-disable-next-line no-unused-vars
  streamTransactions(publicKey, onTransaction) {
    return this.server.transactions()
      .forAccount(publicKey)
      .cursor('now')
      .stream({
        onmessage: (tx) => onTransaction(tx),
        onerror: (error) => console.error('Stream error:', error),
      });
  }

  /**
   * Verify a donation transaction by hash
   * @param {string} transactionHash - Transaction hash to verify
   * @returns {Promise<{verified: boolean, transaction: Object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async verifyTransaction(transactionHash) {
    try {
      const tx = await this.server.transaction(transactionHash).call();
      return {
        verified: true,
        transaction: tx,
      };
    } catch (error) {
      return {
        verified: false,
        error: error.message,
      };
    }
  }
}

module.exports = StellarService;
