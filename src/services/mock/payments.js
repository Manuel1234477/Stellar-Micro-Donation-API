const crypto = require('crypto');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');
const { isSameAsset, serializeAsset } = require('../../utils/stellarAsset');

const NATIVE_ASSET = { type: 'native', code: 'XLM', issuer: null };

class MockPayments {
  constructor(service) {
    this.service = service;
  }

  async buildTransaction(sourcePublicKey, operations, options = {}) {
    if (!this.service.isValidAddress(sourcePublicKey)) {
      throw new ValidationError('Invalid source public key');
    }
    return {
      sourcePublicKey,
      operations: Array.isArray(operations) ? operations : [],
      options,
      mockTransactionId: `mock_tx_${crypto.randomBytes(8).toString('hex')}`,
      _isMockTransaction: true,
      _unsigned: true,
      source: sourcePublicKey,
    };
  }

  async buildPaymentTransaction(sourcePublicKey, destinationPublicKey, amount, options = {}) {
    if (!this.service.isValidAddress(sourcePublicKey) || !this.service.isValidAddress(destinationPublicKey)) {
      throw new ValidationError('Invalid source or destination public key');
    }

    return this.buildTransaction(sourcePublicKey, [{
      type: 'payment',
      destination: destinationPublicKey,
      amount: String(amount),
      asset: options.asset || NATIVE_ASSET,
    }], options);
  }

  async signTransaction(transaction, secretKey) {
    if (!transaction || typeof transaction !== 'object') {
      throw new ValidationError('Invalid transaction');
    }
    if (!secretKey || typeof secretKey !== 'string') {
      throw new ValidationError('Invalid secret key');
    }

    return {
      ...transaction,
      signature: `mock_sign_${crypto.randomBytes(12).toString('hex')}`,
      signedBy: secretKey,
      hash: `mock_hash_${crypto.randomBytes(12).toString('hex')}`,
      _signed: true,
      _unsigned: false,
    };
  }

  async submitTransaction(tx) {
    if (!tx || typeof tx !== 'object') {
      throw new ValidationError('Invalid transaction');
    }

    if (this.service._submitTransactionShouldFail) {
      this.service._submitTransactionShouldFail = false;
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Mock submitTransaction failure');
    }

    const hash = tx.hash || `mock_submitted_${crypto.randomBytes(12).toString('hex')}`;
    const ledger = Math.floor(Math.random() * 1000000) + 1;
    
    // Store in transactions history if source/dest is known
    if (tx.source) {
      const storedTx = {
        hash,
        transactionId: hash,
        source: tx.source,
        destination: tx.operations?.[0]?.destination || 'unknown',
        amount: tx.operations?.[0]?.amount || '0',
        asset: tx.operations?.[0]?.asset || NATIVE_ASSET,
        timestamp: new Date().toISOString(),
        ledger,
        status: 'confirmed',
        fee: '0.0000100',
      };
      this.service._storeTransaction(storedTx);
    }

    return {
      successful: true,
      hash,
      ledger,
      result: 'success',
      status: 'confirmed', // For property tests expecting 'status'
    };
  }

  async submitSignedTransaction(signedXDR) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._simulateFailure();
    if (!signedXDR || typeof signedXDR !== 'string') {
      throw new ValidationError('signedXDR must be a non-empty string');
    }
    const transactionId = `mock_tx_${crypto.randomBytes(8).toString('hex')}`;
    const hash = `mock_hash_${crypto.randomBytes(16).toString('hex')}`;
    const ledger = Math.floor(Math.random() * 1000000) + 1;
    return { transactionId, hash, ledger, offerId: Math.floor(Math.random() * 100000) + 1 };
  }

  async sendDonation({ sourceSecret, destinationPublic, amount, memo, memoType = 'text', asset = NATIVE_ASSET, validAfter = 0, validBefore = 0 }) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validateSecretKey(sourceSecret);
      this.service._validatePublicKey(destinationPublic);
      this.service._validateAmount(amount);
      this.service._simulateFailure();
      this.service._simulateRandomFailure();

      if (validAfter && validBefore && validAfter >= validBefore) {
        throw new ValidationError('validAfter must be strictly less than validBefore');
      }

      const currentTime = this.service.getCurrentSystemTime();
      
      if (validAfter && currentTime < validAfter) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Transaction error: Time bounds violation. Current time (${currentTime}) is before validAfter (${validAfter}). Transaction is not yet valid.`,
          { retryable: false }
        );
      }

      if (validBefore && currentTime > validBefore) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Transaction error: Time bounds violation. Current time (${currentTime}) is after validBefore (${validBefore}). Transaction has expired.`,
          { retryable: false }
        );
      }

      const MemoValidator = require('../../utils/memoValidator');
      if (memo) {
        const memoValidation = MemoValidator.validateWithType(memo, memoType);
        if (!memoValidation.valid) {
          throw new ValidationError(memoValidation.error);
        }
      }

      const sourceWallet = this.service._findWalletBySecret(sourceSecret);
      if (!sourceWallet) {
        throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
      }
      if (sourceWallet.publicKey === destinationPublic) {
        throw new ValidationError('Source and destination accounts cannot be the same.');
      }

      const destWallet = this.service.wallets.get(destinationPublic);
      if (!destWallet) {
        throw new NotFoundError(
          `Destination account not found. The account ${destinationPublic} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      this.service._ensureDestinationFunded(destWallet);

      this.service._applyAssetTransfer({
        sourceWallet,
        destWallet,
        asset,
        amountNum: parseFloat(amount),
      });

      sourceWallet.sequence = (parseInt(sourceWallet.sequence, 10) + 1).toString();

      const transaction = this.service._storeTransaction({
        transactionId: `mock_${crypto.randomBytes(16).toString('hex')}`,
        source: sourceWallet.publicKey,
        destination: destinationPublic,
        amount: Number(amount).toFixed(7),
        asset: serializeAsset(asset),
        memo: memo || '',
        memoType,
        validAfter: validAfter || 0,
        validBefore: validBefore || 0,
        timestamp: new Date().toISOString(),
        ledger: Math.floor(Math.random() * 1000000) + 1000000,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        fee: '0.0000100',
        sequence: sourceWallet.sequence,
      });

      return {
        transactionId: transaction.transactionId,
        ledger: transaction.ledger,
        status: transaction.status,
        confirmedAt: transaction.confirmedAt,
      };
    });
  }

  async discoverBestPath({ sourceAsset, sourceAmount, destAsset, destAmount }) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();

      if (this.service.failureSimulation.enabled && this.service.failureSimulation.type === 'no_path') {
        return null;
      }

      const rate = this.service._getConversionRate(sourceAsset, destAsset);
      if (!rate || !Number.isFinite(rate)) {
        return null;
      }

      const resolvedSourceAmount = sourceAmount || (parseFloat(destAmount) / rate).toFixed(7);
      const resolvedDestAmount = destAmount || (parseFloat(sourceAmount) * rate).toFixed(7);
      const conversionRate = (parseFloat(resolvedDestAmount) / parseFloat(resolvedSourceAmount)).toFixed(7);
      const path = sourceAsset.type !== 'native' && destAsset.type !== 'native'
        ? [serializeAsset(NATIVE_ASSET)]
        : [];

      return {
        sourceAsset: serializeAsset(sourceAsset),
        sourceAmount: resolvedSourceAmount,
        destAsset: serializeAsset(destAsset),
        destAmount: resolvedDestAmount,
        conversionRate,
        path,
      };
    });
  }

  async pathPayment(sourceAsset, sourceAmount, destAsset, destAmount, path, options = {}) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._simulateFailure();

      if (this.service.failureSimulation.enabled && this.service.failureSimulation.type === 'path_payment_failed') {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'Path payment failed on the Stellar DEX.'
        );
      }

      const estimate = await this.discoverBestPath({
        sourceAsset,
        sourceAmount,
        destAsset,
        destAmount,
      });

      if (!estimate) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          'No Stellar path payment route was found.'
        );
      }

      const submittedPath = (path || []).map((asset) => serializeAsset(asset));
      if (JSON.stringify(submittedPath) !== JSON.stringify(estimate.path || [])) {
        throw new ValidationError('Submitted path does not match the server-discovered route');
      }

      const sourceWallet = this.service._findWalletBySecret(options.sourceSecret);
      if (!sourceWallet) {
        throw new ValidationError('Invalid source secret key. The provided secret key does not match any account.');
      }

      const destWallet = this.service.wallets.get(options.destinationPublic);
      if (!destWallet) {
        throw new NotFoundError(
          `Destination account not found. The account ${options.destinationPublic} does not exist on the network.`,
          ERROR_CODES.WALLET_NOT_FOUND
        );
      }

      this.service._ensureDestinationFunded(destWallet);

      const sourceBalance = this.service._getWalletAssetBalance(sourceWallet, sourceAsset);
      if (sourceAsset.type === 'native') {
        const baseReserve = parseFloat(this.service.config.baseReserve);
        if (sourceBalance - parseFloat(sourceAmount) < baseReserve) {
          throw new BusinessLogicError(
            ERROR_CODES.TRANSACTION_FAILED,
            `Insufficient balance. Account must maintain minimum balance of ${this.service.config.baseReserve} XLM.`
          );
        }
      } else if (sourceBalance < parseFloat(sourceAmount)) {
        throw new BusinessLogicError(
          ERROR_CODES.INSUFFICIENT_BALANCE,
          `Insufficient ${sourceAsset.code} balance for payment`
        );
      }

      this.service._setWalletAssetBalance(sourceWallet, sourceAsset, sourceBalance - parseFloat(sourceAmount));
      const destBalance = this.service._getWalletAssetBalance(destWallet, destAsset);
      this.service._setWalletAssetBalance(destWallet, destAsset, destBalance + parseFloat(destAmount));
      sourceWallet.sequence = (parseInt(sourceWallet.sequence, 10) + 1).toString();

      const transaction = this.service._storeTransaction({
        transactionId: `mock_${crypto.randomBytes(16).toString('hex')}`,
        source: sourceWallet.publicKey,
        destination: options.destinationPublic,
        amount: Number(sourceAmount).toFixed(7),
        destinationAmount: Number(destAmount).toFixed(7),
        asset: serializeAsset(sourceAsset),
        destinationAsset: serializeAsset(destAsset),
        path: estimate.path || [],
        memo: options.memo || '',
        timestamp: new Date().toISOString(),
        ledger: Math.floor(Math.random() * 1000000) + 1000000,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        fee: '0.0000100',
        sequence: sourceWallet.sequence,
      });

      return {
        transactionId: transaction.transactionId,
        ledger: transaction.ledger,
        status: transaction.status,
        confirmedAt: transaction.confirmedAt,
        envelopeXdr: 'mock_envelope_' + crypto.randomBytes(8).toString('hex'),
        fee: 100,
      };
    });
  }

  async sendBatchDonations(sourceSecret, payments) {
    let lastResult;
    for (const payment of payments) {
      lastResult = await this.sendDonation({
        sourceSecret,
        destinationPublic: payment.destinationPublic,
        amount: payment.amount,
        memo: payment.memo,
      });
    }
    return { transactionId: lastResult.transactionId, ledger: lastResult.ledger };
  }

  async getTransactionHistory(publicKey, limit = 10) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();
    this.service._validatePublicKey(publicKey);

    const wallet = this.service.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }

    return (this.service.transactions.get(publicKey) || []).slice(-limit).reverse();
  }

  async verifyTransaction(transactionHash) {
    await this.service._simulateNetworkDelay();
    this.service._checkRateLimit();

    if (!transactionHash || typeof transactionHash !== 'string') {
      throw new ValidationError('Transaction hash must be a valid string');
    }

    for (const txList of this.service.transactions.values()) {
      const transaction = txList.find((tx) => tx.transactionId === transactionHash || tx.hash === transactionHash);
      if (transaction) {
        return {
          verified: true,
          status: transaction.status,
          transaction: {
            id: transaction.transactionId,
            source: transaction.source,
            destination: transaction.destination,
            amount: transaction.amount,
            asset: transaction.asset,
            destinationAmount: transaction.destinationAmount,
            destinationAsset: transaction.destinationAsset,
            path: transaction.path,
            memo: transaction.memo,
            timestamp: transaction.timestamp,
            ledger: transaction.ledger,
            status: transaction.status,
            confirmedAt: transaction.confirmedAt,
            fee: transaction.fee,
            sequence: transaction.sequence,
          },
        };
      }
    }

    throw new NotFoundError(
      `Transaction not found. The transaction ${transactionHash} does not exist on the network.`,
      ERROR_CODES.TRANSACTION_NOT_FOUND
    );
  }

  streamTransactions(publicKey, onTransaction) {
    this.service._validatePublicKey(publicKey);

    const wallet = this.service.wallets.get(publicKey);
    if (!wallet) {
      throw new NotFoundError(
        `Account not found. The account ${publicKey} does not exist on the network.`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }
    if (typeof onTransaction !== 'function') {
      throw new ValidationError('onTransaction must be a function');
    }

    if (!this.service.streamListeners.has(publicKey)) {
      this.service.streamListeners.set(publicKey, []);
    }
    this.service.streamListeners.get(publicKey).push(onTransaction);

    return () => {
      const listeners = this.service.streamListeners.get(publicKey);
      if (listeners) {
        const index = listeners.indexOf(onTransaction);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  async sendPayment(sourcePublicKey, destinationPublic, amount, memo = '') {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validatePublicKey(sourcePublicKey);
      this.service._validatePublicKey(destinationPublic);
      this.service._validateAmount(amount.toString());
      this.service._simulateFailure();
      this.service._simulateRandomFailure();

      let sourceWallet = this.service.wallets.get(sourcePublicKey);
      if (!sourceWallet) {
        sourceWallet = {
          publicKey: sourcePublicKey,
          secretKey: this.service._generateKeypair().secretKey,
          balance: '10000.0000000',
          assetBalances: { native: '10000.0000000' },
          createdAt: new Date().toISOString(),
          sequence: '0',
        };
        this.service.wallets.set(sourcePublicKey, sourceWallet);
      }

      let destWallet = this.service.wallets.get(destinationPublic);
      if (!destWallet) {
        destWallet = {
          publicKey: destinationPublic,
          secretKey: this.service._generateKeypair().secretKey,
          balance: '1.0000000',
          assetBalances: { native: '1.0000000' },
          createdAt: new Date().toISOString(),
          sequence: '0',
        };
        this.service.wallets.set(destinationPublic, destWallet);
      }

      this.service._applyAssetTransfer({
        sourceWallet,
        destWallet,
        asset: NATIVE_ASSET,
        amountNum: parseFloat(amount),
      });
      sourceWallet.sequence = (parseInt(sourceWallet.sequence, 10) + 1).toString();

      const transaction = this.service._storeTransaction({
        hash: `mock_${crypto.randomBytes(16).toString('hex')}`,
        source: sourcePublicKey,
        destination: destinationPublic,
        amount: Number(amount).toFixed(7),
        memo,
        timestamp: new Date().toISOString(),
        ledger: Math.floor(Math.random() * 1000000) + 1000000,
        status: 'confirmed',
        fee: '0.0000100',
        sequence: sourceWallet.sequence,
      });

      log.info('MOCK_STELLAR_SERVICE', 'Payment simulated', {
        amount: Number(amount).toFixed(7),
        source: `${sourcePublicKey.substring(0, 8)}...`,
        destination: `${destinationPublic.substring(0, 8)}...`,
      });

      return {
        hash: transaction.hash,
        ledger: transaction.ledger,
      };
    });
  }

  async pathPaymentStrictSend(sourceSecret, sendAsset, sendAmount, destPublicKey, destAsset, minDestAmount, options = {}) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._simulateFailure();

      const route = await this.discoverBestPath({ sourceAsset: sendAsset, sourceAmount: sendAmount, destAsset });
      if (!route) {
        throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'No payment path found between the specified assets');
      }

      if (parseFloat(route.destAmount) < parseFloat(minDestAmount)) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Slippage tolerance exceeded: expected at least ${minDestAmount} ${destAsset.code}, ` +
          `but best path yields ${route.destAmount}`
        );
      }

      return this.pathPayment(sendAsset, sendAmount, destAsset, minDestAmount, route.path || [], {
        sourceSecret,
        destinationPublic: destPublicKey,
        memo: options.memo,
      }).then(result => ({
        ...result,
        sourceAmount: sendAmount.toString(),
        destAmount: route.destAmount,
      }));
    });
  }

  async pathPaymentStrictReceive(sourceSecret, sendAsset, maxSendAmount, destPublicKey, destAsset, destAmount, options = {}) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._simulateFailure();

      const route = await this.discoverBestPath({ sourceAsset: sendAsset, destAsset, destAmount });
      if (!route) {
        throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'No payment path found between the specified assets');
      }

      if (parseFloat(route.sourceAmount) > parseFloat(maxSendAmount)) {
        throw new BusinessLogicError(
          ERROR_CODES.TRANSACTION_FAILED,
          `Slippage tolerance exceeded: would require ${route.sourceAmount} ${sendAsset.code}, ` +
          `but maximum is ${maxSendAmount}`
        );
      }

      return this.pathPayment(sendAsset, route.sourceAmount, destAsset, destAmount, route.path || [], {
        sourceSecret,
        destinationPublic: destPublicKey,
        memo: options.memo,
      }).then(result => ({
        ...result,
        sourceAmount: route.sourceAmount,
        destAmount: destAmount.toString(),
      }));
    });
  }

  async findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount) {
    return this.service._executeWithRetry(async () => {
      await this.service._simulateNetworkDelay();
      this.service._checkRateLimit();
      this.service._validatePublicKey(sourcePublicKey);
      void destPublicKey;

      if (this.service.failureSimulation.enabled && this.service.failureSimulation.type === 'no_path') {
        return [];
      }

      const wallet = this.service.wallets.get(sourcePublicKey);
      if (!wallet) {
        throw new NotFoundError('Account not found', ERROR_CODES.WALLET_NOT_FOUND);
      }

      this.service._ensureAssetBalances(wallet);
      const paths = [];

      for (const [key] of Object.entries(wallet.assetBalances)) {
        const sourceAsset = key === 'native'
          ? { type: 'native', code: 'XLM', issuer: null }
          : (() => { const [code, issuer] = key.split(':'); return { type: 'credit_alphanum', code, issuer }; })();

        if (isSameAsset(sourceAsset, destAsset)) continue;

        const route = await this.discoverBestPath({ sourceAsset, destAsset, destAmount });
        if (route) paths.push(route);
      }

      return paths;
    });
  }

  async getTransaction(transactionHash) {
    if (!transactionHash || typeof transactionHash !== 'string') {
      throw new ValidationError('Invalid transaction hash');
    }

    for (const txList of this.service.transactions.values()) {
      const tx = txList.find((item) => item.transactionId === transactionHash || item.hash === transactionHash);
      if (tx) {
        return tx;
      }
    }

    throw new NotFoundError('Transaction not found', ERROR_CODES.TRANSACTION_NOT_FOUND);
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

  async simulateTransaction(xdr) {
    const simulatedAt = new Date().toISOString();

    if (!xdr || typeof xdr !== 'string' || xdr.trim() === '') {
      return {
        success: false,
        errors: ['xdr is required and must be a non-empty string'],
        simulatedAt,
      };
    }

    if (this.service.failureSimulation.enabled) {
      const failureType = this.service.failureSimulation.type || 'unknown';
      return {
        success: false,
        errors: [`Simulation failed: ${failureType}`],
        simulatedAt,
      };
    }

    const BASE_FEE_STROOPS = 100;
    const multiplier = this.service.config.feeMultiplier !== undefined ? this.service.config.feeMultiplier : 1;
    const feePerOp = Math.round(BASE_FEE_STROOPS * multiplier);
    const estimatedFeeStroops = feePerOp;

    return {
      success: true,
      estimatedFee: {
        stroops: estimatedFeeStroops,
        xlm: (estimatedFeeStroops / 1e7).toFixed(7),
      },
      estimatedResult: {
        operationType: 'payment',
        sourceAccount: null,
        destinationAccount: null,
      },
      simulatedAt,
    };
  }
}

module.exports = MockPayments;
