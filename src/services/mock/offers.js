const crypto = require('crypto');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');

class MockOffers {
  constructor(service) {
    this.service = service;
  }

  async createOffer({ sourceSecret, sellingAsset, buyingAsset, amount, price, offerId = 0 }) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();
    this.service._validateSecretKey(sourceSecret);

    if (!sellingAsset || !buyingAsset) throw new ValidationError('sellingAsset and buyingAsset are required');
    if (sellingAsset === buyingAsset) throw new ValidationError('sellingAsset and buyingAsset must be different');

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum < 0) throw new ValidationError('amount must be a non-negative number');

    const priceNum = typeof price === 'string' && price.includes('/')
      ? parseInt(price.split('/')[0], 10) / parseInt(price.split('/')[1], 10)
      : parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) throw new ValidationError('price must be a positive number');

    const sourcePublic = this.service._secretToPublic(sourceSecret);
    const wallet = this.service.wallets.get(sourcePublic);
    if (!wallet) throw new NotFoundError('Source account not found', ERROR_CODES.WALLET_NOT_FOUND);

    if (!this.service.offers) this.service.offers = new Map();

    if (offerId !== 0) {
      const existing = this.service.offers.get(offerId);
      if (!existing) throw new NotFoundError(`Offer ${offerId} not found`, ERROR_CODES.NOT_FOUND);
      if (existing.seller !== sourcePublic) throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Not the offer owner');
      if (parseFloat(existing.amount) === 0) throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Offer already filled or cancelled');
      if (amountNum === 0) {
        existing.amount = '0.0000000';
        existing.status = 'cancelled';
      } else {
        existing.amount = amountNum.toFixed(7);
        existing.price = priceNum.toFixed(7);
        existing.status = 'active';
      }
      const txId = crypto.randomBytes(32).toString('hex');
      const ledger = Math.floor(Math.random() * 1000000) + 1000000;
      return { offerId, transactionId: txId, ledger };
    }

    const newOfferId = Date.now() * 1000 + (this.service._offerCounter = ((this.service._offerCounter || 0) + 1) % 1000);
    this.service.offers.set(newOfferId, {
      id: newOfferId,
      seller: sourcePublic,
      sellingAsset,
      buyingAsset,
      amount: amountNum.toFixed(7),
      price: priceNum.toFixed(7),
      createdAt: new Date().toISOString(),
      status: 'active',
    });

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;
    return { offerId: newOfferId, transactionId: txId, ledger };
  }

  async cancelOffer({ sourceSecret, sellingAsset, buyingAsset, offerId }) {
    const result = await this.createOffer({ sourceSecret, sellingAsset, buyingAsset, amount: '0', price: '1', offerId });
    return { transactionId: result.transactionId, ledger: result.ledger };
  }

  async listOffers(publicKey) {
    if (!this.service.offers) return [];
    return Array.from(this.service.offers.values()).filter(o => o.seller === publicKey && o.status === 'active');
  }

  async getOrderBook(sellingAsset, buyingAsset, limit = 20) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();

    if (!sellingAsset || !buyingAsset) throw new ValidationError('sellingAsset and buyingAsset are required');

    if (!this.service.offers) this.service.offers = new Map();

    const asks = Array.from(this.service.offers.values())
      .filter(o => o.sellingAsset === sellingAsset && o.buyingAsset === buyingAsset)
      .slice(0, limit)
      .map(o => ({ price: o.price, amount: o.amount, price_r: { n: 1, d: 1 } }));

    const bids = Array.from(this.service.offers.values())
      .filter(o => o.sellingAsset === buyingAsset && o.buyingAsset === sellingAsset)
      .slice(0, limit)
      .map(o => ({ price: o.price, amount: o.amount, price_r: { n: 1, d: 1 } }));

    return {
      bids,
      asks,
      base: { asset_type: sellingAsset === 'XLM' ? 'native' : 'credit_alphanum4', asset_code: sellingAsset },
      counter: { asset_type: buyingAsset === 'XLM' ? 'native' : 'credit_alphanum4', asset_code: buyingAsset },
    };
  }

  streamOrderbook(sellingAsset, buyingAsset, onUpdate) {
    if (!this.service._orderbookListeners) this.service._orderbookListeners = new Map();
    const key = `${sellingAsset}:${buyingAsset}`;
    if (!this.service._orderbookListeners.has(key)) this.service._orderbookListeners.set(key, new Set());
    this.service._orderbookListeners.get(key).add(onUpdate);

    return () => {
      const listeners = this.service._orderbookListeners.get(key);
      if (listeners) listeners.delete(onUpdate);
    };
  }

  triggerOrderbookUpdate(sellingAsset, buyingAsset, data) {
    if (!this.service._orderbookListeners) return;
    const key = `${sellingAsset}:${buyingAsset}`;
    const listeners = this.service._orderbookListeners.get(key);
    if (!listeners) return;
    for (const cb of listeners) {
      try { cb(data); } catch (e) { /* ignore */ }
    }
  }

  getOrderbookListenerCount(sellingAsset, buyingAsset) {
    if (!this.service._orderbookListeners) return 0;
    const key = `${sellingAsset}:${buyingAsset}`;
    return this.service._orderbookListeners.has(key) ? this.service._orderbookListeners.get(key).size : 0;
  }
}

module.exports = MockOffers;
