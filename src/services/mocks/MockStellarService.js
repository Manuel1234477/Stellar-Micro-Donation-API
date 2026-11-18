'use strict';

/**
 * MockStellarService
 *
 * Deterministic, network-free drop-in for the real StellarService.
 * Must structurally conform to StellarServiceInterface (ADR-002).
 */

const STELLAR_PRECISION = 7;

function round7(value) {
  return Number(Number(value).toFixed(STELLAR_PRECISION));
}

class MockStellarService {
  constructor(options = {}) {
    this.network = options.network || 'testnet';
    this.horizonUrl = options.horizonUrl || 'https://horizon-testnet.stellar.org';
    this._orderBook = options.orderBook || null;
  }

  // ---------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------

  async getAccount(publicKey) {
    return {
      id: publicKey,
      account_id: publicKey,
      sequence: '0',
      subentry_count: 0,
      thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
      flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
      balances: [
        {
          balance: '10000.0000000',
          asset_type: 'native',
        },
      ],
      signers: [{ weight: 1, key: publicKey, type: 'ed25519_public_key' }],
      data: {},
    };
  }

  async getAccountBalances(publicKey) {
    const account = await this.getAccount(publicKey);
    return account.balances;
  }

  async accountExists(publicKey) {
    return typeof publicKey === 'string' && publicKey.length > 0;
  }

  // ---------------------------------------------------------------------------
  // Payments / transactions
  // ---------------------------------------------------------------------------

  async sendPayment(params = {}) {
    return {
      hash: 'mock-payment-hash',
      ledger: 1,
      successful: true,
      source_account: params.sourcePublicKey || params.source || null,
      destination: params.destinationPublicKey || params.destination || null,
      amount: params.amount || '0',
      asset: params.asset || { type: 'native' },
    };
  }

  async getTransaction(hash) {
    return {
      hash,
      ledger: 1,
      successful: true,
      created_at: '2020-01-01T00:00:00Z',
      source_account: 'GMOCKSOURCEACCOUNT',
    };
  }

  async getTransactions(publicKey, options = {}) {
    return {
      records: [],
      _links: { next: null, prev: null },
      publicKey,
      limit: options.limit || 10,
    };
  }

  // ---------------------------------------------------------------------------
  // Order book
  // ---------------------------------------------------------------------------

  async getOrderBook(sellingAsset, buyingAsset, options = {}) {
    if (this._orderBook) {
      return this._orderBook;
    }

    const limit = options.limit || 20;
    const bids = [];
    const asks = [];

    for (let i = 0; i < limit; i += 1) {
      const price = round7(1 + i * 0.01);
      bids.push({
        price_r: { n: Math.round(price * 10000000), d: 10000000 },
        price: price.toFixed(STELLAR_PRECISION),
        amount: round7(100 - i).toFixed(STELLAR_PRECISION),
      });
      asks.push({
        price_r: { n: Math.round((price + 0.005) * 10000000), d: 10000000 },
        price: (price + 0.005).toFixed(STELLAR_PRECISION),
        amount: round7(100 - i).toFixed(STELLAR_PRECISION),
      });
    }

    return {
      bids,
      asks,
      base: sellingAsset || { asset_type: 'native' },
      counter: buyingAsset || { asset_type: 'native' },
    };
  }

  // ---------------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------------

  async getOffers(sellerPublicKey, options = {}) {
    return {
      records: [],
      _links: { next: null, prev: null },
      seller: sellerPublicKey || null,
      limit: options.limit || 10,
    };
  }

  async createOffer(params = {}) {
    return {
      id: 'mock-offer-id',
      paging_token: 'mock-offer-token',
      seller: params.sellerPublicKey || params.seller || null,
      selling: params.selling || { asset_type: 'native' },
      buying: params.buying || { asset_type: 'native' },
      amount: params.amount || '0',
      price: params.price || '1.0000000',
    };
  }

  async cancelOffer(offerId) {
    return { id: offerId, canceled: true };
  }

  // ---------------------------------------------------------------------------
  // Liquidity pools
  // ---------------------------------------------------------------------------

  async getLiquidityPools(options = {}) {
    return {
      records: [],
      _links: { next: null, prev: null },
      limit: options.limit || 10,
    };
  }

  async getLiquidityPool(poolId) {
    return {
      id: poolId,
      paging_token: poolId,
      fee_bp: 30,
      type: 'constant_product',
      total_shares: '0.0000000',
      total_trustlines: '0',
      reserves: [],
    };
  }

  // ---------------------------------------------------------------------------
  // Channels
  // ---------------------------------------------------------------------------

  async getChannels() {
    return [];
  }

  async getChannel(channelId) {
    return {
      id: channelId,
      publicKey: null,
      sequence: '0',
      active: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Assets / network
  // ---------------------------------------------------------------------------

  async getAssets(options = {}) {
    return {
      records: [],
      _links: { next: null, prev: null },
      limit: options.limit || 10,
    };
  }

  async getNetwork() {
    return {
      network: this.network,
      horizonUrl: this.horizonUrl,
      passphrase:
        this.network === 'public'
          ? 'Public Global Stellar Network ; September 2015'
          : 'Test SDF Network ; September 2015',
    };
  }

  async getLedger(sequence) {
    return {
      sequence: String(sequence),
      hash: 'mock-ledger-hash',
      closed_at: '2020-01-01T00:00:00Z',
      successful_transaction_count: 0,
      failed_transaction_count: 0,
    };
  }

  async getLatestLedger() {
    return this.getLedger(1);
  }

  async isHealthy() {
    return true;
  }
}

module.exports = MockStellarService;
