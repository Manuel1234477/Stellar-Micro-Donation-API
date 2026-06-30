const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../../utils/stellarErrorHandler');
const log = require('../../utils/log');

class StellarChannels {
  constructor(service) {
    this.service = service;
  }

  async openChannel(sourceSecret, recipientPublicKey, depositAmount) {
    return StellarErrorHandler.wrap(async () => {
      const escrowKeypair = StellarSdk.Keypair.random();
      const escrowPublicKey = escrowKeypair.publicKey();

      const createAccountOp = StellarSdk.Operation.createAccount({
        destination: escrowPublicKey,
        startingBalance: depositAmount,
      });

      const setOptionsOp = StellarSdk.Operation.setOptions({
        signer: {
          ed25519PublicKey: recipientPublicKey,
          weight: 1,
        },
      });

      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.service.server.loadAccount(sourceKeypair.publicKey());

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(createAccountOp)
        .addOperation(setOptionsOp)
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);

      const result = await this.service.server.submitTransaction(transaction);
      return {
        escrowPublicKey,
        escrowSecret: escrowKeypair.secret(),
        transactionId: result.hash,
        ledger: result.ledger,
      };
    }, 'openChannel');
  }

  async updateChannel(channelId, newAmount) {
    return { channelId, balance: newAmount, updated: true };
  }

  async closeChannel(channelId, escrowSecret, recipientPublicKey, amount) {
    return StellarErrorHandler.wrap(async () => {
      const escrowKeypair = StellarSdk.Keypair.fromSecret(escrowSecret);
      const account = await this.service.server.loadAccount(escrowKeypair.publicKey());

      const paymentOp = StellarSdk.Operation.payment({
        destination: recipientPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: amount,
      });

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(paymentOp)
        .setTimeout(30)
        .build();

      transaction.sign(escrowKeypair);

      const result = await this.service.server.submitTransaction(transaction);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
      };
    }, 'closeChannel');
  }
}

module.exports = StellarChannels;
