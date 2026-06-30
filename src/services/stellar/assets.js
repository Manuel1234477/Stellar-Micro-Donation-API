const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../../utils/stellarErrorHandler');
const log = require('../../utils/log');
const { ValidationError } = require('../../utils/errors');

class StellarAssets {
  constructor(service) {
    this.service = service;
  }

  async addTrustline(accountSecret, assetCode, issuerPublic, limit = null) {
    return StellarErrorHandler.wrap(async () => {
      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const STELLAR_MAX_LIMIT = '922337203685.4775807';

      if (limit !== null && limit !== undefined) {
        const limitNum = parseFloat(limit);
        if (isNaN(limitNum) || limitNum <= 0) {
          throw new ValidationError('Trust limit must be a positive numeric string');
        }
        if (parseFloat(limit) > parseFloat(STELLAR_MAX_LIMIT)) {
          throw new ValidationError(`Trust limit cannot exceed Stellar maximum of ${STELLAR_MAX_LIMIT}`);
        }
      }

      const keypair = StellarSdk.Keypair.fromSecret(accountSecret);
      const asset = new StellarSdk.Asset(assetCode, issuerPublic);

      const account = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(keypair.publicKey())
      );

      const opParams = { asset };
      if (limit !== null && limit !== undefined) {
        opParams.limit = String(limit);
      }

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.service._getNetworkPassphrase(),
      })
        .addOperation(StellarSdk.Operation.changeTrust(opParams))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      const resolvedLimit = limit !== null && limit !== undefined ? String(limit) : STELLAR_MAX_LIMIT;

      log.info('STELLAR_SERVICE', 'Trustline established', {
        assetCode, issuerPublic, limit: resolvedLimit, hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, issuerPublic, limit: resolvedLimit };
    }, 'addTrustline');
  }

  async removeTrustline(accountSecret, assetCode, issuerPublic) {
    return StellarErrorHandler.wrap(async () => {
      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }
      if (!issuerPublic || typeof issuerPublic !== 'string') {
        throw new ValidationError('issuerPublic is required');
      }

      const keypair = StellarSdk.Keypair.fromSecret(accountSecret);
      const asset = new StellarSdk.Asset(assetCode, issuerPublic);
      const account = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(keypair.publicKey())
      );

      const balanceLine = account.balances.find((b) => (
        b.asset_type !== 'native' &&
        b.asset_code === assetCode &&
        b.asset_issuer === issuerPublic
      ));

      if (!balanceLine) {
        throw new ValidationError('Trustline not found for the requested asset');
      }

      const balance = parseFloat(balanceLine.balance || '0');
      if (balance > 0) {
        throw new ValidationError('Cannot remove a trustline with a non-zero balance');
      }

      const transaction = new StellarSdk.TransactionBuilder(account, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.service._getNetworkPassphrase(),
      })
        .addOperation(StellarSdk.Operation.changeTrust({
          asset,
          limit: '0',
        }))
        .setTimeout(30)
        .build();

      transaction.sign(keypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Trustline removed', {
        assetCode,
        issuerPublic,
        hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, issuerPublic };
    }, 'removeTrustline');
  }

  async getTrustlines(publicKey) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(publicKey),
        'loadAccountForBalances'
      );
      return account.balances
        .filter(b => b.asset_type !== 'native')
        .map(b => ({
          asset: { code: b.asset_code, issuer: b.asset_issuer },
          balance: b.balance,
          limit: b.limit
        }));
    }, 'getTrustlines');
  }

  async issueAsset(issuerSecret, assetCode, amount, recipientPublic) {
    return StellarErrorHandler.wrap(async () => {
      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const issuerKeypair = StellarSdk.Keypair.fromSecret(issuerSecret);
      const issuerPublic = issuerKeypair.publicKey();

      if (issuerPublic === recipientPublic) {
        throw new ValidationError('Issuer and recipient cannot be the same account');
      }

      const asset = new StellarSdk.Asset(assetCode, issuerPublic);

      const issuerAccount = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(issuerPublic)
      );

      const transaction = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase:
          this.service.network === 'public'
            ? StellarSdk.Networks.PUBLIC
            : StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: recipientPublic,
          asset,
          amount: amount.toString(),
        }))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Asset issued', {
        assetCode, issuerPublic, recipientPublic, amount, hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, issuerPublic, amount };
    }, 'issueAsset');
  }

  async burnAsset(holderSecret, assetCode, issuerPublic, amount) {
    return StellarErrorHandler.wrap(async () => {
      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const holderKeypair = StellarSdk.Keypair.fromSecret(holderSecret);
      const holderPublic = holderKeypair.publicKey();

      if (holderPublic === issuerPublic) {
        throw new ValidationError('Holder and issuer cannot be the same account');
      }

      const asset = new StellarSdk.Asset(assetCode, issuerPublic);

      const holderAccount = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(holderPublic)
      );

      const transaction = new StellarSdk.TransactionBuilder(holderAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase:
          this.service.network === 'public'
            ? StellarSdk.Networks.PUBLIC
            : StellarSdk.Networks.TESTNET,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: issuerPublic,
          asset,
          amount: amount.toString(),
        }))
        .setTimeout(30)
        .build();

      transaction.sign(holderKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Asset burned', {
        assetCode, issuerPublic, holderPublic, amount, hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, amount };
    }, 'burnAsset');
  }

  async clawback(issuerSecret, from, assetCode, amount) {
    return StellarErrorHandler.wrap(async () => {
      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }
      if (!from) throw new ValidationError('from (holder public key) is required');
      if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
        throw new ValidationError('amount must be a positive number');
      }

      const issuerKeypair = StellarSdk.Keypair.fromSecret(issuerSecret);
      const issuerPublic = issuerKeypair.publicKey();
      const asset = new StellarSdk.Asset(assetCode, issuerPublic);

      const issuerAccount = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(issuerPublic)
      );

      const transaction = new StellarSdk.TransactionBuilder(issuerAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.clawback({ asset, from, amount: amount.toString() }))
        .setTimeout(30)
        .build();

      transaction.sign(issuerKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Asset clawback executed', {
        assetCode, issuerPublic, from, amount, hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, from, amount };
    }, 'clawback');
  }

  async distributeAsset(distributorSecret, assetCode, issuerPublicKey, recipientPublicKey, amount) {
    return StellarErrorHandler.wrap(async () => {
      if (!assetCode || !/^[A-Za-z0-9]{1,12}$/.test(assetCode)) {
        throw new ValidationError('Asset code must be 1-12 alphanumeric characters');
      }

      const distributorKeypair = StellarSdk.Keypair.fromSecret(distributorSecret);
      const distributorPublic = distributorKeypair.publicKey();

      if (distributorPublic === recipientPublicKey) {
        throw new ValidationError('Distributor and recipient cannot be the same account');
      }

      const asset = new StellarSdk.Asset(assetCode, issuerPublicKey);

      const distributorAccount = await this.service._executeWithRetry(() =>
        this.service.server.loadAccount(distributorPublic)
      );

      const transaction = new StellarSdk.TransactionBuilder(distributorAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.service._getNetworkPassphrase(),
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: recipientPublicKey,
          asset,
          amount: amount.toString(),
        }))
        .setTimeout(30)
        .build();

      transaction.sign(distributorKeypair);
      const result = await this.service._submitTransactionWithNetworkSafety(transaction);

      log.info('STELLAR_SERVICE', 'Asset distributed', {
        assetCode, issuerPublicKey, distributorPublic, recipientPublicKey, amount, hash: result.hash,
      });

      return { hash: result.hash, ledger: result.ledger, assetCode, issuerPublicKey, recipientPublicKey, amount };
    }, 'distributeAsset');
  }
}

module.exports = StellarAssets;
