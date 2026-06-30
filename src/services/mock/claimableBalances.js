const crypto = require('crypto');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');

class MockClaimableBalances {
  constructor(service) {
    this.service = service;
  }

  async createClaimableBalance({ sourceSecret, amount, claimants, predicate = null }) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();

    this.service._validateSecretKey(sourceSecret);
    this.service._validateAmount(amount);

    if (!Array.isArray(claimants) || claimants.length === 0) {
      throw new ValidationError('At least one claimant is required');
    }
    if (claimants.length > 10) {
      throw new ValidationError('Maximum 10 claimants allowed');
    }
    for (const c of claimants) {
      this.service._validatePublicKey(c.destination);
    }

    const sourcePublic = this.service._secretToPublic(sourceSecret);
    const wallet = this.service.wallets.get(sourcePublic);
    if (!wallet) {
      throw new NotFoundError('Source account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const amountNum = parseFloat(amount);
    const balanceNum = parseFloat(wallet.balance);
    if (balanceNum < amountNum) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Insufficient balance for claimable balance creation'
      );
    }

    wallet.balance = (balanceNum - amountNum).toFixed(7);

    const balanceId = `00000000${crypto.randomBytes(28).toString('hex')}`;
    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    if (!this.service.claimableBalances) this.service.claimableBalances = new Map();

    this.service.claimableBalances.set(balanceId, {
      balanceId,
      amount,
      claimants: claimants.map(c => ({ destination: c.destination, predicate: c.predicate || predicate || null })),
      sponsor: sourcePublic,
      claimed: false,
      claimedBy: null,
      createdAt: new Date().toISOString(),
      predicate,
    });

    return { balanceId, transactionId: txId, ledger };
  }

  async claimBalance({ balanceId, claimantSecret }) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();

    this.service._validateSecretKey(claimantSecret);

    if (!this.service.claimableBalances) this.service.claimableBalances = new Map();

    const balance = this.service.claimableBalances.get(balanceId);
    if (!balance) {
      throw new NotFoundError('Claimable balance not found', ERROR_CODES.NOT_FOUND);
    }
    if (balance.claimed) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Claimable balance has already been claimed'
      );
    }

    const claimantPublic = this.service._secretToPublic(claimantSecret);
    const eligible = balance.claimants.find(c => c.destination === claimantPublic);
    if (!eligible) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Account is not an eligible claimant for this balance'
      );
    }

    const pred = eligible.predicate || balance.predicate;
    if (pred) {
      const now = Date.now();
      if (pred.notBefore && now < pred.notBefore) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Claimable balance is not yet available (notBefore condition not met)'
        );
      }
      if (pred.notAfter && now > pred.notAfter) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Claimable balance has expired (notAfter condition exceeded)'
        );
      }
    }

    let claimantWallet = this.service.wallets.get(claimantPublic);
    if (!claimantWallet) {
      claimantWallet = { publicKey: claimantPublic, balance: '0', createdAt: new Date().toISOString() };
      this.service.wallets.set(claimantPublic, claimantWallet);
    }
    claimantWallet.balance = (parseFloat(claimantWallet.balance) + parseFloat(balance.amount)).toFixed(7);

    balance.claimed = true;
    balance.claimedBy = claimantPublic;
    balance.claimedAt = new Date().toISOString();

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    return { transactionId: txId, ledger, amount: balance.amount };
  }

  async listClaimableBalances(publicKey) {
    if (!this.service.claimableBalances) this.service.claimableBalances = new Map();
    return Array.from(this.service.claimableBalances.values())
      .filter(cb => !cb.claimed && cb.claimants.some(c => c.destination === publicKey));
  }
}

module.exports = MockClaimableBalances;
