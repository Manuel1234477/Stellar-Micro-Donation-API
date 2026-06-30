const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../../utils/stellarErrorHandler');
const { toStellarSdkAsset } = require('../../utils/stellarAsset');

class StellarClaimableBalances {
  constructor(service) {
    this.service = service;
  }

  async listClaimableBalances(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const records = [];
      let cursor = undefined;
      do {
        const resp = await this.service.server.claimableBalances()
          .claimant(publicKey)
          .cursor(cursor)
          .limit(200)
          .call();
        records.push(...resp.records);
        cursor = resp.records.length === 200 ? resp.records[199].paging_token : undefined;
      } while (cursor);
      return records;
    }, 'listClaimableBalances');
  }

  async createClaimableBalance(sourceSecret, asset, amount, claimants) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForClaimableBalance'
      );
      const sdkAsset = asset ? toStellarSdkAsset(asset) : StellarSdk.Asset.native();
      const sdkClaimants = claimants.map(c => new StellarSdk.Claimant(c.destination, c.predicate));

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.createClaimableBalance({
          asset: sdkAsset,
          amount: amount.toString(),
          claimants: sdkClaimants,
        }))
        .setTimeout(30)
        .build();

      transaction.sign(sourceKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      const _txResult = await this.service.server.transactions().transaction(result.hash).call();
      const effects = await this.service.server.effects().forTransaction(result.hash).call();
      const cbEffect = effects.records.find(e => e.type === 'claimable_balance_created');
      if (!cbEffect) throw new Error('Claimable balance creation effect not found');

      return {
        balanceId: cbEffect.balance_id,
        transactionId: result.hash,
        ledger: result.ledger,
      };
    }, 'createClaimableBalance');
  }

  async claimBalance(claimantSecret, balanceId) {
    return StellarErrorHandler.wrap(async () => {
      const claimantKeypair = StellarSdk.Keypair.fromSecret(claimantSecret);
      const claimantAccount = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(claimantKeypair.publicKey()),
        'loadAccountForClaimBalance'
      );

      const transaction = new StellarSdk.TransactionBuilder(claimantAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.claimClaimableBalance({
          balanceId,
        }))
        .setTimeout(30)
        .build();

      transaction.sign(claimantKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
      };
    }, 'claimBalance');
  }
}

module.exports = StellarClaimableBalances;
