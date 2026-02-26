/**
 * Wallet Builder - Test Data Builder
 * 
 * RESPONSIBILITY: Simplifies wallet creation and funding for tests
 * OWNER: QA/Testing Team
 * 
 * Provides fluent API for creating and configuring test wallets with sensible defaults.
 */

class WalletBuilder {
  constructor(stellarService) {
    this.stellarService = stellarService;
    this.shouldFund = false;
    this.fundingAmount = '10000.0000000'; // Default Stellar testnet funding
    this.walletData = null;
  }

  /**
   * Enable funding for this wallet
   * @param {string} amount - Optional custom funding amount
   * @returns {WalletBuilder}
   */
  funded(amount = null) {
    this.shouldFund = true;
    if (amount) {
      this.fundingAmount = amount;
    }
    return this;
  }

  /**
   * Create wallet without funding
   * @returns {WalletBuilder}
   */
  unfunded() {
    this.shouldFund = false;
    return this;
  }

  /**
   * Build and return the wallet
   * @returns {Promise<Object>} Wallet with publicKey and secretKey
   */
  async build() {
    const wallet = await this.stellarService.createWallet();
    
    if (this.shouldFund) {
      await this.stellarService.fundTestnetWallet(wallet.publicKey);
    }
    
    return wallet;
  }

  /**
   * Build multiple wallets with same configuration
   * @param {number} count - Number of wallets to create
   * @returns {Promise<Array<Object>>}
   */
  async buildMany(count) {
    const wallets = [];
    for (let i = 0; i < count; i++) {
      wallets.push(await this.build());
    }
    return wallets;
  }

  /**
   * Create a funded donor wallet (common pattern)
   * @returns {Promise<Object>}
   */
  static async createFundedDonor(stellarService) {
    return new WalletBuilder(stellarService).funded().build();
  }

  /**
   * Create a funded recipient wallet (common pattern)
   * @returns {Promise<Object>}
   */
  static async createFundedRecipient(stellarService) {
    return new WalletBuilder(stellarService).funded().build();
  }

  /**
   * Create donor and recipient pair (very common pattern)
   * @returns {Promise<{donor: Object, recipient: Object}>}
   */
  static async createDonorRecipientPair(stellarService) {
    const [donor, recipient] = await new WalletBuilder(stellarService)
      .funded()
      .buildMany(2);
    
    return { donor, recipient };
  }
}

module.exports = WalletBuilder;
