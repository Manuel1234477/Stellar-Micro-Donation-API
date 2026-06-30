const StellarSdk = require('stellar-sdk');
const StellarErrorHandler = require('../../utils/stellarErrorHandler');
const log = require('../../utils/log');
const { withTimeout } = require('../../utils/timeoutHandler');
const { toStellarSdkAsset, serializeAsset, isSameAsset, normalizeHorizonAsset } = require('../../utils/stellarAsset');

class StellarPayments {
  constructor(service) {
    this.service = service;
  }

  async buildTransaction(sourcePublicKey, operations, options = {}) {
    return StellarErrorHandler.wrap(async () => {
      const account = await this.service.loadAccount(sourcePublicKey);
      const builder = new StellarSdk.TransactionBuilder(account, {
        fee: options.fee || this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      });

      for (const op of operations) {
        if (op.type === 'payment') {
          builder.addOperation(StellarSdk.Operation.payment({
            destination: op.destination,
            asset: op.asset ? toStellarSdkAsset(op.asset) : StellarSdk.Asset.native(),
            amount: String(op.amount),
          }));
        } else {
          builder.addOperation(op);
        }
      }

      if (options.memo) {
        builder.addMemo(StellarSdk.Memo.text(options.memo));
      }

      builder.setTimeout(options.timeout || 30);
      return builder.build();
    }, 'buildTransaction');
  }

  async buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options = {}) {
    return this.buildTransaction(sourcePublicKey, [{
      type: 'payment',
      destination: destinationPublicKey,
      amount,
      asset: options.asset || null,
    }], options);
  }

  async signTransaction(transaction, secretKey) {
    return StellarErrorHandler.wrap(async () => {
      const keypair = StellarSdk.Keypair.fromSecret(secretKey);
      transaction.sign(keypair);
      return transaction;
    }, 'signTransaction');
  }

  async submitTransaction(transaction) {
    return StellarErrorHandler.wrap(async () => {
      const result = await this.service.server.submitTransaction(transaction);
      return {
        successful: true,
        hash: result.hash,
        ledger: result.ledger,
        result: result.result_xdr,
      };
    }, 'submitTransaction');
  }

  async submitSignedTransaction(signedXDR) {
    return StellarErrorHandler.wrap(async () => {
      if (!signedXDR || typeof signedXDR !== 'string') {
        const { ValidationError } = require('../../utils/errors');
        throw new ValidationError('signedXDR must be a non-empty string');
      }
      const transaction = StellarSdk.TransactionBuilder.fromXDR(signedXDR, this.service.networkPassphrase);
      const response = await this.service._executeWithRetry(
        () => this.service.server.submitTransaction(transaction),
        'submitSignedTransaction'
      );
      return {
        transactionId: response.id,
        hash: response.hash,
        ledger: response.ledger,
      };
    }, 'submitSignedTransaction');
  }

  async sendDonation({ sourceSecret, destinationPublic, amount, memo = '', memoType = 'text', asset = null, validAfter = 0, validBefore = 0 }) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForDonation'
      );
      const paymentAsset = asset ? toStellarSdkAsset(asset) : StellarSdk.Asset.native();

      const timebounds = {
        minTime: String(validAfter || '0'), 
        maxTime: String(validBefore || '0')
      };

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
        timebounds,
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: destinationPublic,
          asset: paymentAsset,
          amount: amount.toString(),
        }))
        .setTimeout(30);

      if (memo) {
        const MemoValidator = require('../../utils/memoValidator');
        const memoCheck = MemoValidator.validateFinalMemo(memo, memoType);
        if (!memoCheck.valid) {
          const err = new Error(memoCheck.error);
          err.code = memoCheck.code;
          err.statusCode = 422;
          throw err;
        }

        switch (memoType) {
          case 'hash':
            transaction.addMemo(StellarSdk.Memo.hash(Buffer.from(memo, 'hex')));
            break;
          case 'return':
            transaction.addMemo(StellarSdk.Memo.return(Buffer.from(memo, 'hex')));
            break;
          case 'id':
            transaction.addMemo(StellarSdk.Memo.id(memo.toString()));
            break;
          default: // 'text'
            transaction.addMemo(StellarSdk.Memo.text(memo));
        }
      }

      const builtTx = transaction.build();
      builtTx.sign(sourceKeypair);

      const envelopeXdr = builtTx.toEnvelope().toXDR('base64');
      const result = await this.service._submitTransactionWithNetworkSafety(builtTx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
        envelopeXdr,
        fee: parseInt(this.service.baseFee),
      };
    }, 'sendDonation');
  }

  async discoverBestPath({ sourceAsset, sourceAmount, destAsset, destAmount }) {
    return StellarErrorHandler.wrap(async () => {
      if (isSameAsset(sourceAsset, destAsset)) {
        const effectiveAmount = sourceAmount || destAmount;

        return {
          sourceAsset: serializeAsset(sourceAsset),
          sourceAmount: effectiveAmount,
          destAsset: serializeAsset(destAsset),
          destAmount: effectiveAmount,
          conversionRate: '1.0000000',
          path: [],
        };
      }

      let records = [];

      if (sourceAmount) {
        const response = await this.service._executeWithRetry(
          () => this.service.server
            .strictSendPaths(toStellarSdkAsset(sourceAsset), sourceAmount, [toStellarSdkAsset(destAsset)])
            .call(),
          'strictSendPaths'
        );
        records = response.records || [];
      } else if (destAmount) {
        const response = await this.service._executeWithRetry(
          () => this.service.server
            .strictReceivePaths([toStellarSdkAsset(sourceAsset)], toStellarSdkAsset(destAsset), destAmount)
            .call(),
          'strictReceivePaths'
        );
        records = response.records || [];
      } else {
        throw new Error('Either sourceAmount or destAmount is required for path discovery');
      }

      if (records.length === 0) {
        return null;
      }

      const bestRecord = [...records].sort((left, right) => {
        const leftDest = parseFloat(left.destination_amount || left.destination_amount_max || '0');
        const rightDest = parseFloat(right.destination_amount || right.destination_amount_max || '0');
        return rightDest - leftDest;
      })[0];

      const normalizedPath = (bestRecord.path || []).map(normalizeHorizonAsset);
      const resolvedSourceAmount = sourceAmount || bestRecord.source_amount;
      const resolvedDestAmount = bestRecord.destination_amount || destAmount;
      const conversionRate = (
        parseFloat(resolvedSourceAmount) > 0
          ? (parseFloat(resolvedDestAmount) / parseFloat(resolvedSourceAmount)).toFixed(7)
          : '0.0000000'
      );

      return {
        sourceAsset: serializeAsset(sourceAsset),
        sourceAmount: resolvedSourceAmount,
        destAsset: serializeAsset(destAsset),
        destAmount: resolvedDestAmount,
        conversionRate,
        path: normalizedPath.map(serializeAsset),
      };
    }, 'discoverBestPath');
  }

  async pathPayment(sourceAsset, sourceAmount, destAsset, destAmount, path, options = {}) {
    return StellarErrorHandler.wrap(async () => {
      const { sourceSecret, destinationPublic, memo = '' } = options;

      if (!sourceSecret || !destinationPublic) {
        throw new Error('sourceSecret and destinationPublic are required for path payments');
      }

      const discoveredPath = await this.discoverBestPath({
        sourceAsset,
        sourceAmount,
        destAsset,
        destAmount,
      });

      if (!discoveredPath) {
        throw new Error('No Stellar path payment route found');
      }

      const normalizedPath = (path || []).map((asset) => ({
        type: asset.type,
        code: asset.code,
        issuer: asset.issuer || null,
      }));

      const discoveredNormalizedPath = (discoveredPath.path || []).map((asset) => ({
        type: asset.type,
        code: asset.code,
        issuer: asset.issuer || null,
      }));

      if (!this.service._isSamePath(normalizedPath, discoveredNormalizedPath)) {
        throw new Error('Submitted payment path does not match the best available Stellar route');
      }

      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForPathPayment'
      );

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      })
        .addOperation(StellarSdk.Operation.pathPaymentStrictSend({
          sendAsset: toStellarSdkAsset(sourceAsset),
          sendAmount: sourceAmount.toString(),
          destination: destinationPublic,
          destAsset: toStellarSdkAsset(destAsset),
          destMin: destAmount.toString(),
          path: normalizedPath.map(toStellarSdkAsset),
        }))
        .setTimeout(30);

      if (memo) {
        transaction.addMemo(StellarSdk.Memo.text(memo));
      }

      const builtTx = transaction.build();
      builtTx.sign(sourceKeypair);

      const result = await this.service._submitTransactionWithNetworkSafety(builtTx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
      };
    }, 'pathPayment');
  }

  async sendBatchDonations(sourceSecret, payments) {
    return StellarErrorHandler.wrap(async () => {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourceAccount = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForBatch'
      );

      const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.service.network === 'public' ? StellarSdk.Networks.PUBLIC : StellarSdk.Networks.TESTNET,
      }).setTimeout(30);

      for (const p of payments) {
        builder.addOperation(StellarSdk.Operation.payment({
          destination: p.destinationPublic,
          asset: StellarSdk.Asset.native(),
          amount: p.amount.toString(),
        }));
      }

      const builtTx = builder.build();
      builtTx.sign(sourceKeypair);

      const envelopeXdr = builtTx.toEnvelope().toXDR('base64');
      const result = await this.service._submitTransactionWithNetworkSafety(builtTx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
        envelopeXdr,
        fee: parseInt(StellarSdk.BASE_FEE),
      };
    }, 'sendBatchDonations');
  }

  async getTransactionHistory(publicKey, limit = 10) {
    return StellarErrorHandler.wrap(async () => {
      const result = await this.service._executeWithRetry(
        () => this.service.server.transactions()
          .forAccount(publicKey)
          .limit(limit)
          .order('desc')
          .call(),
        'getTransactionHistory'
      );
      return result.records;
    }, 'getTransactionHistory');
  }

  streamTransactions(publicKey, onTransaction, { cursor = 'now' } = {}) {
    const streamTimeout = this.service.timeouts.stream;
    let lastMessageTime = Date.now();
    let timeoutTimer = null;

    const resetTimeout = () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      // eslint-disable-next-line local/no-bare-timers
      timeoutTimer = setTimeout(() => {
        const elapsed = Date.now() - lastMessageTime;
        log.error('STELLAR_SERVICE', 'Transaction stream timeout', {
          publicKey,
          timeoutMs: streamTimeout,
          elapsedMs: elapsed
        });
        if (closeStream) {
          closeStream();
        }
      }, streamTimeout);
    };

    resetTimeout();

    const closeStream = this.service.server.transactions()
      .forAccount(publicKey)
      .cursor(cursor)
      .stream({
        onmessage: (tx) => {
          lastMessageTime = Date.now();
          resetTimeout();
          onTransaction(tx);
        },
        onerror: (error) => {
          if (timeoutTimer) {
            clearTimeout(timeoutTimer);
          }
          log.error('STELLAR_SERVICE', 'Transaction stream error', { 
            error: error.message,
            publicKey
          });
        },
      });

    return () => {
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
      if (closeStream) {
        closeStream();
      }
    };
  }

  async verifyTransaction(transactionHash) {
    return StellarErrorHandler.wrap(async () => {
      const tx = await this.service._executeWithRetry(
        () => this.service.server.transaction(transactionHash).call(),
        'verifyTransaction'
      );
      return {
        verified: true,
        transaction: tx,
      };
    }, 'verifyTransaction');
  }

  async pathPaymentStrictSend(sourceSecret, sendAsset, sendAmount, destPublicKey, destAsset, minDestAmount, options = {}) {
    return StellarErrorHandler.wrap(async () => {
      const route = await this.discoverBestPath({ sourceAsset: sendAsset, sourceAmount: sendAmount, destAsset });
      if (!route) {
        throw new Error('No payment path found between the specified assets');
      }

      if (parseFloat(route.destAmount) < parseFloat(minDestAmount)) {
        throw new Error(
          `Slippage tolerance exceeded: expected at least ${minDestAmount} ${destAsset.code}, ` +
          `but best path yields ${route.destAmount}`
        );
      }

      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForStrictSend'
      );

      const builder = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      }).addOperation(StellarSdk.Operation.pathPaymentStrictSend({
        sendAsset: toStellarSdkAsset(sendAsset),
        sendAmount: sendAmount.toString(),
        destination: destPublicKey,
        destAsset: toStellarSdkAsset(destAsset),
        destMin: minDestAmount.toString(),
        path: (route.path || []).map(a => toStellarSdkAsset(a)),
      })).setTimeout(30);

      if (options.memo) builder.addMemo(StellarSdk.Memo.text(options.memo));

      const tx = builder.build();
      tx.sign(sourceKeypair);

      const result = await this.service._submitTransactionWithNetworkSafety(tx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
        sourceAmount: sendAmount.toString(),
        destAmount: route.destAmount,
      };
    }, 'pathPaymentStrictSend');
  }

  async pathPaymentStrictReceive(sourceSecret, sendAsset, maxSendAmount, destPublicKey, destAsset, destAmount, options = {}) {
    return StellarErrorHandler.wrap(async () => {
      const route = await this.discoverBestPath({ sourceAsset: sendAsset, destAsset, destAmount });
      if (!route) {
        throw new Error('No payment path found between the specified assets');
      }

      if (parseFloat(route.sourceAmount) > parseFloat(maxSendAmount)) {
        throw new Error(
          `Slippage tolerance exceeded: would require ${route.sourceAmount} ${sendAsset.code}, ` +
          `but maximum is ${maxSendAmount}`
        );
      }

      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const account = await this.service._executeWithRetry(
        () => this.service.server.loadAccount(sourceKeypair.publicKey()),
        'loadAccountForStrictReceive'
      );

      const builder = new StellarSdk.TransactionBuilder(account, {
        fee: this.service.baseFee,
        networkPassphrase: this.service.networkPassphrase,
      }).addOperation(StellarSdk.Operation.pathPaymentStrictReceive({
        sendAsset: toStellarSdkAsset(sendAsset),
        sendMax: maxSendAmount.toString(),
        destination: destPublicKey,
        destAsset: toStellarSdkAsset(destAsset),
        destAmount: destAmount.toString(),
        path: (route.path || []).map(a => toStellarSdkAsset(a)),
      })).setTimeout(30);

      if (options.memo) builder.addMemo(StellarSdk.Memo.text(options.memo));

      const tx = builder.build();
      tx.sign(sourceKeypair);

      const result = await this.service._submitTransactionWithNetworkSafety(tx);
      return {
        transactionId: result.hash,
        ledger: result.ledger,
        sourceAmount: route.sourceAmount,
        destAmount: destAmount.toString(),
      };
    }, 'pathPaymentStrictReceive');
  }

  async findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount) {
    return StellarErrorHandler.wrap(async () => {
      void destPublicKey;
      const balances = await this.service.getAccountBalances(sourcePublicKey);
      const paths = [];

      for (const balance of balances) {
        const sourceAsset = normalizeHorizonAsset(balance);
        if (isSameAsset(sourceAsset, destAsset)) continue;

        const route = await this.discoverBestPath({ sourceAsset, destAsset, destAmount });
        if (route) paths.push(route);
      }

      return paths;
    }, 'findPaymentPaths');
  }

  async getTransaction(transactionHash) {
    return StellarErrorHandler.wrap(async () => {
      const tx = await this.service._executeWithRetry(
        () => this.service.server.transaction(transactionHash).call(),
        'getTransaction'
      );
      return tx;
    }, 'getTransaction');
  }

  stroopsToXlm(stroops) {
    const numberValue = Number(stroops);
    if (Number.isNaN(numberValue)) {
      throw new ValidationError('Invalid stroops amount');
    }
    return (numberValue / 1e7).toFixed(7);
  }

  xlmToStroops(xlm) {
    const numberValue = Number(xlm);
    if (Number.isNaN(numberValue)) {
      throw new ValidationError('Invalid XLM amount');
    }
    return Math.round(numberValue * 1e7);
  }
}

module.exports = StellarPayments;
