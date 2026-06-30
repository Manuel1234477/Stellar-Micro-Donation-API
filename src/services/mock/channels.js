const crypto = require('crypto');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../../utils/errors');

class MockChannels {
  constructor(service) {
    this.service = service;
  }

  async openChannel(sourceSecret, recipientPublicKey, depositAmount) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();
    this.service._validateSecretKey(sourceSecret);
    this.service._validatePublicKey(recipientPublicKey);

    const sourcePublic = this.service._secretToPublic(sourceSecret);
    const sourceWallet = this.service.wallets.get(sourcePublic);
    if (!sourceWallet) {
      throw new NotFoundError('Source account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const amt = parseFloat(depositAmount);
    if (isNaN(amt) || amt <= 0) {
      throw new ValidationError('Deposit amount must be a positive number');
    }

    const sourceBal = parseFloat(sourceWallet.balance);
    if (sourceBal < amt) {
      throw new ValidationError('Insufficient balance for deposit amount');
    }

    // Deduct from source
    sourceWallet.balance = (sourceBal - amt).toFixed(7);

    // Create mock escrow account
    const escrowKeypair = this.service._generateKeypair();
    this.service.wallets.set(escrowKeypair.publicKey, {
      publicKey: escrowKeypair.publicKey,
      secretKey: escrowKeypair.secretKey,
      balance: amt.toFixed(7),
      assetBalances: { native: amt.toFixed(7) },
      createdAt: new Date().toISOString(),
      sequence: '0',
      sponsored: false,
    });

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    return {
      escrowPublicKey: escrowKeypair.publicKey,
      escrowSecret: escrowKeypair.secretKey,
      transactionId: txId,
      ledger,
    };
  }

  async updateChannel(channelId, newAmount) {
    return { channelId, balance: newAmount, updated: true };
  }

  async closeChannel(channelId, escrowSecret, recipientPublicKey, amount) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();
    this.service._validateSecretKey(escrowSecret);
    this.service._validatePublicKey(recipientPublicKey);

    const escrowPublic = this.service._secretToPublic(escrowSecret);
    const escrowWallet = this.service.wallets.get(escrowPublic);
    if (!escrowWallet) {
      throw new NotFoundError('Escrow account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const recipientWallet = this.service.wallets.get(recipientPublicKey);
    if (!recipientWallet) {
      throw new NotFoundError('Recipient account not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const amt = parseFloat(amount);
    const escrowBal = parseFloat(escrowWallet.balance);
    if (escrowBal < amt) {
      throw new ValidationError('Insufficient escrow balance for settlement');
    }

    // Settlement payment
    escrowWallet.balance = (escrowBal - amt).toFixed(7);
    recipientWallet.balance = (parseFloat(recipientWallet.balance) + amt).toFixed(7);

    const txId = crypto.randomBytes(32).toString('hex');
    const ledger = Math.floor(Math.random() * 1000000) + 1000000;

    return {
      transactionId: txId,
      ledger,
    };
  }
}

module.exports = MockChannels;
