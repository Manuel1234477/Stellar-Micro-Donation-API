const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../../utils/stellarErrorHandler');
const log = require('../../utils/log');
const { serializeAsset, normalizeHorizonAsset } = require('../../utils/stellarAsset');

class StellarOffers {
  constructor(service) {
    this.service = service;
  }

  async createOffer({ sourceSecret, sellingAsset, buyingAsset, amount, price, offerId = 0 }) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.service._executeWithRetry(() => this.service.server.loadAccount(keypair.publicKey()));
      const sellAsset = sellingAsset === 'XLM' ? StellarSdk.Asset.native() : (() => { const [code, issuer] = sellingAsset.split(':'); return new StellarSdk.Asset(code, issuer); })();
      const buyAsset = buyingAsset === 'XLM' ? StellarSdk.Asset.native() : (() => { const [code, issuer] = buyingAsset.split(':'); return new StellarSdk.Asset(code, issuer); })();
      const op = StellarSdk.Operation.manageSellOffer({
        selling: sellAsset,
        buying: buyAsset,
        amount: amount.toString(),
        price: price.toString(),
        offerId: offerId || 0,
      });
      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      }).addOperation(op).setTimeout(30).build();
      tx.sign(keypair);
      const result = await this.service._submitTransactionWithNetworkSafety(tx);
      return { offerId: offerId || 0, transactionId: result.hash, ledger: result.ledger };
    }, 'createOffer');
  }

  async cancelOffer({ sourceSecret, sellingAsset, buyingAsset, offerId }) {
    return this.createOffer({ sourceSecret, sellingAsset, buyingAsset, amount: '0', price: '1', offerId });
  }

  async listOffers(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const offersPage = await this.service._executeWithRetry(() => this.service.server.offers().forAccount(publicKey).call());
      return (offersPage.records || []).map(o => ({
        id: o.id,
        sellingAsset: serializeAsset(normalizeHorizonAsset(o.selling)),
        buyingAsset: serializeAsset(normalizeHorizonAsset(o.buying)),
        amount: o.amount,
        price: o.price,
        price_r: o.price_r,
        seller: o.seller,
        last_modified_ledger: o.last_modified_ledger,
        last_modified_time: o.last_modified_time,
        sponsor: o.sponsor,
        paging_token: o.paging_token,
        ...o
      }));
    }, 'listOffers');
  }

  async getOrderBook(sellingAsset, buyingAsset, limit = 20) {
    return StellarErrorHandler.wrap(async () => {
      const parseAsset = (assetStr) => {
        if (assetStr === 'XLM' || assetStr === 'native') return StellarSdk.Asset.native();
        const [code, issuer] = assetStr.split(':');
        if (!issuer) throw new Error(`Invalid asset format: ${assetStr}. Use 'XLM' or 'CODE:ISSUER'`);
        return new StellarSdk.Asset(code, issuer);
      };

      const result = await this.service._executeWithRetry(
        () => this.service.server.orderbook(parseAsset(sellingAsset), parseAsset(buyingAsset)).limit(limit).call(),
        'getOrderBook'
      );

      return {
        bids: result.bids,
        asks: result.asks,
        base: result.base,
        counter: result.counter,
      };
    }, 'getOrderBook');
  }

  streamOrderbook(sellingAsset, buyingAsset, onUpdate) {
    const parseAsset = (assetStr) => {
      if (assetStr === 'XLM' || assetStr === 'native') return StellarSdk.Asset.native();
      const [code, issuer] = assetStr.split(':');
      if (!issuer) throw new Error(`Invalid asset format: ${assetStr}. Use 'XLM' or 'CODE:ISSUER'`);
      return new StellarSdk.Asset(code, issuer);
    };

    const close = this.service.server.orderbook(parseAsset(sellingAsset), parseAsset(buyingAsset)).stream({
      onmessage: (update) => {
        try {
          onUpdate(update);
        } catch (err) {
          log.error('STELLAR_SERVICE', 'orderbook stream callback error', { error: err.message });
        }
      },
      onerror: (err) => {
        log.error('STELLAR_SERVICE', 'orderbook stream error', { error: err.message });
      },
    });

    return close;
  }
}

module.exports = StellarOffers;
