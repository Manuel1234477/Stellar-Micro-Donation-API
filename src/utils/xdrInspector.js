/**
 * XDR Inspector Utility (#1986)
 *
 * RESPONSIBILITY: Centralized decoding and inspection of Stellar XDR envelopes.
 * OWNER: Backend / Security Team
 * DEPENDENCIES: StellarSdk, ValidationError
 *
 * Implements a single, shared XDR inspection engine backing both public tools
 * and admin inspection endpoints with resource guards (operation caps, nesting checks)
 * and server-environment-aware default network passphrases.
 */

const StellarSdk = require('../services/stellar/sdk.js');
const { ValidationError } = require('./errors');

let log;
try {
  log = require('./log');
} catch {
  log = console;
}

const DEFAULT_MAX_OPERATIONS = 100;
const DEFAULT_MAX_DEPTH = 10;

/**
 * Resolve the default network passphrase matching server configuration.
 * Prioritizes explicit env overrides, then STELLAR_NETWORK / STELLAR_ENVIRONMENT.
 *
 * @returns {string} Stellar network passphrase
 */
function getDefaultNetworkPassphrase() {
  if (process.env.STELLAR_NETWORK_PASSPHRASE) {
    return process.env.STELLAR_NETWORK_PASSPHRASE;
  }

  const rawEnv = (process.env.STELLAR_NETWORK || process.env.STELLAR_ENVIRONMENT || 'testnet').toLowerCase();
  if (rawEnv === 'public' || rawEnv === 'mainnet') {
    return StellarSdk.Networks.PUBLIC;
  }
  if (rawEnv === 'futurenet') {
    return StellarSdk.Networks.FUTURENET;
  }
  return StellarSdk.Networks.TESTNET;
}

/**
 * Format a Stellar Asset into a standardized object representation.
 * @param {Object} asset - Stellar SDK Asset instance
 * @returns {Object|null}
 */
function formatAsset(asset) {
  if (!asset) return null;

  if (typeof asset.isNative === 'function' && asset.isNative()) {
    return { type: 'native', code: 'XLM' };
  }

  return {
    type: typeof asset.getAssetType === 'function' ? asset.getAssetType() : (asset.type || 'unknown'),
    code: typeof asset.getCode === 'function' ? asset.getCode() : (asset.code || 'unknown'),
    issuer: typeof asset.getIssuer === 'function' ? asset.getIssuer() : (asset.issuer || null),
  };
}

/**
 * Extract operation-specific details based on operation type.
 * @param {Object} operation - Stellar SDK operation
 * @returns {Object} Structured operation properties
 */
function extractOperationFields(operation) {
  const fields = {};

  switch (operation.type) {
    case 'payment':
      fields.destination = operation.destination;
      fields.asset = formatAsset(operation.asset);
      fields.amount = operation.amount;
      break;

    case 'createAccount':
      fields.destination = operation.destination;
      fields.startingBalance = operation.startingBalance;
      break;

    case 'pathPaymentStrictReceive':
    case 'pathPaymentStrictSend':
      fields.sendAsset = formatAsset(operation.sendAsset);
      fields.sendMax = operation.sendMax;
      fields.destination = operation.destination;
      fields.destAsset = formatAsset(operation.destAsset);
      fields.destAmount = operation.destAmount;
      fields.path = operation.path ? operation.path.map(formatAsset) : [];
      break;

    case 'changeTrust':
      fields.line = formatAsset(operation.line);
      fields.limit = operation.limit;
      break;

    case 'allowTrust':
      fields.trustor = operation.trustor;
      fields.assetCode = operation.assetCode;
      fields.authorize = operation.authorize;
      break;

    case 'setOptions':
      if (operation.inflationDest) fields.inflationDest = operation.inflationDest;
      if (operation.clearFlags) fields.clearFlags = operation.clearFlags;
      if (operation.setFlags) fields.setFlags = operation.setFlags;
      if (operation.masterWeight !== undefined) fields.masterWeight = operation.masterWeight;
      if (operation.lowThreshold !== undefined) fields.lowThreshold = operation.lowThreshold;
      if (operation.medThreshold !== undefined) fields.medThreshold = operation.medThreshold;
      if (operation.highThreshold !== undefined) fields.highThreshold = operation.highThreshold;
      if (operation.homeDomain) fields.homeDomain = operation.homeDomain;
      if (operation.signer) fields.signer = operation.signer;
      break;

    case 'manageData':
      fields.name = operation.name;
      fields.value = operation.value ? operation.value.toString('base64') : null;
      break;

    case 'bumpSequence':
      fields.bumpTo = operation.bumpTo;
      break;

    case 'manageBuyOffer':
    case 'manageSellOffer':
      fields.selling = formatAsset(operation.selling);
      fields.buying = formatAsset(operation.buying);
      fields.amount = operation.amount;
      fields.price = operation.price;
      fields.offerId = operation.offerId || '0';
      break;

    case 'createPassiveSellOffer':
      fields.selling = formatAsset(operation.selling);
      fields.buying = formatAsset(operation.buying);
      fields.amount = operation.amount;
      fields.price = operation.price;
      break;

    case 'accountMerge':
      fields.destination = operation.destination;
      break;

    case 'liquidityPoolDeposit':
      fields.liquidityPoolId = operation.liquidityPoolId;
      fields.maxAmountA = operation.maxAmountA;
      fields.maxAmountB = operation.maxAmountB;
      fields.minPrice = operation.minPrice;
      fields.maxPrice = operation.maxPrice;
      break;

    case 'liquidityPoolWithdraw':
      fields.liquidityPoolId = operation.liquidityPoolId;
      fields.amount = operation.amount;
      fields.minAmountA = operation.minAmountA;
      fields.minAmountB = operation.minAmountB;
      break;

    default:
      Object.keys(operation).forEach((key) => {
        if (key !== 'type' && key !== 'source') {
          fields[key] = operation[key];
        }
      });
  }

  return fields;
}

/**
 * Decode a Stellar memo into structured format.
 * @param {Object} memo - Stellar SDK memo
 * @returns {Object} Decoded memo
 */
function decodeMemo(memo) {
  if (!memo || memo.type === StellarSdk.MemoNone) {
    return { type: 'none', value: null };
  }

  switch (memo.type) {
    case StellarSdk.MemoText:
      return { type: 'text', value: memo.value };

    case StellarSdk.MemoID:
      return { type: 'id', value: memo.value };

    case StellarSdk.MemoHash:
      return { type: 'hash', value: memo.value ? memo.value.toString('hex') : null };

    case StellarSdk.MemoReturn:
      return { type: 'return', value: memo.value ? memo.value.toString('hex') : null };

    default:
      return { type: 'unknown', value: null };
  }
}

/**
 * Decode standard Stellar Transaction into normalized inspection format.
 * @param {Object} tx - Stellar SDK Transaction
 * @param {Object} [options]
 * @returns {Object} Normalized decoded data
 */
function decodeStandardTransaction(tx, options = {}) {
  const maxOperations = typeof options.maxOperations === 'number' ? options.maxOperations : DEFAULT_MAX_OPERATIONS;
  const opCount = Array.isArray(tx.operations) ? tx.operations.length : 0;

  if (opCount > maxOperations) {
    const limitErr = new ValidationError(
      `Transaction exceeds maximum operation limit (${opCount} > ${maxOperations})`,
      { opCount, maxOperations },
      'OPERATION_LIMIT_EXCEEDED'
    );
    limitErr.code = 'OPERATION_LIMIT_EXCEEDED';
    throw limitErr;
  }

  const operations = (tx.operations || []).map((op, index) => {
    const details = { ...extractOperationFields(op) };
    return {
      index,
      type: op.type,
      source: op.source || tx.source,
      details,
      ...details,
    };
  });

  const memo = decodeMemo(tx.memo);
  const timeBounds = tx.timeBounds
    ? {
        min: tx.timeBounds.minTime,
        max: tx.timeBounds.maxTime,
        minTime: tx.timeBounds.minTime,
        maxTime: tx.timeBounds.maxTime,
      }
    : null;

  const signatures = (tx.signatures || []).map((sig) => ({
    hint: typeof sig.hint === 'function' ? sig.hint().toString('hex') : '',
    signature: typeof sig.signature === 'function' ? sig.signature().toString('hex') : '',
    signatureBase64: typeof sig.signature === 'function' ? sig.signature().toString('base64') : '',
  }));

  const hashHex = typeof tx.hash === 'function' ? tx.hash().toString('hex') : null;

  return {
    txHash: hashHex,
    hash: hashHex,
    sourceAccount: tx.source,
    source: tx.source,
    sequence: tx.sequence,
    fee: tx.fee,
    memo: memo.value !== null ? memo : null,
    memoDetails: memo,
    timeBounds,
    operationCount: operations.length,
    operations,
    signatures,
    type: 'transaction',
  };
}

/**
 * Decode FeeBumpTransaction into normalized format.
 * @param {Object} feeBumpTx - Stellar SDK FeeBumpTransaction
 * @param {Object} [options]
 * @returns {Object} Normalized fee-bump breakdown
 */
function decodeFeeBump(feeBumpTx, options = {}) {
  const innerTx = feeBumpTx.innerTransaction;
  const innerDecoded = decodeStandardTransaction(innerTx, options);

  const signatures = (feeBumpTx.signatures || []).map((sig) => ({
    hint: typeof sig.hint === 'function' ? sig.hint().toString('hex') : '',
    signature: typeof sig.signature === 'function' ? sig.signature().toString('hex') : '',
    signatureBase64: typeof sig.signature === 'function' ? sig.signature().toString('base64') : '',
  }));

  const hashHex = typeof feeBumpTx.hash === 'function' ? feeBumpTx.hash().toString('hex') : null;

  return {
    txHash: hashHex,
    hash: hashHex,
    feeSource: feeBumpTx.feeSource,
    fee: feeBumpTx.fee,
    innerTransaction: innerDecoded,
    sourceAccount: innerDecoded.sourceAccount,
    source: innerDecoded.source,
    sequence: innerDecoded.sequence,
    memo: innerDecoded.memo,
    timeBounds: innerDecoded.timeBounds,
    operationCount: innerDecoded.operationCount,
    operations: innerDecoded.operations,
    signatures,
    type: 'feeBump',
  };
}

/**
 * Central XdrInspector Class (#1986)
 */
class XdrInspector {
  /**
   * Decode an arbitrary XDR transaction envelope.
   *
   * @param {string} xdr - Base64 encoded Stellar Transaction Envelope XDR
   * @param {Object} [options] - Decoding options
   * @param {string} [options.networkPassphrase] - Custom network passphrase
   * @param {string} [options.network] - Network identifier ('public', 'mainnet', 'testnet', etc.)
   * @param {number} [options.maxOperations] - Cap on decoded operations (default: 100)
   * @returns {Object} Decoded transaction representation
   */
  static decode(xdr, options = {}) {
    if (!xdr || typeof xdr !== 'string') {
      const vErr = new ValidationError('xdr (Base64 XDR string) is required', null, 'VALIDATION_ERROR');
      vErr.code = 'VALIDATION_ERROR';
      throw vErr;
    }

    // Resolve network passphrase
    let passphrase = options.networkPassphrase;
    if (!passphrase) {
      if (options.network) {
        const net = options.network.toLowerCase();
        passphrase = (net === 'public' || net === 'mainnet')
          ? StellarSdk.Networks.PUBLIC
          : (net === 'futurenet' ? StellarSdk.Networks.FUTURENET : StellarSdk.Networks.TESTNET);
      } else {
        passphrase = getDefaultNetworkPassphrase();
      }
    }

    let envelope;
    let decoded;

    try {
      if (typeof StellarSdk.TransactionBuilder.fromXDR === 'function') {
        envelope = StellarSdk.TransactionBuilder.fromXDR(xdr, passphrase);
      } else if (typeof StellarSdk.TransactionBuilder.fromEnvelope === 'function') {
        envelope = StellarSdk.TransactionBuilder.fromEnvelope(xdr, passphrase);
      } else {
        envelope = new StellarSdk.Transaction(xdr, passphrase);
      }

      if (envelope.constructor && envelope.constructor.name === 'FeeBumpTransaction') {
        decoded = decodeFeeBump(envelope, options);
      } else {
        decoded = decodeStandardTransaction(envelope, options);
      }
    } catch (parseError) {
      if (parseError.code === 'OPERATION_LIMIT_EXCEEDED') {
        throw parseError;
      }

      // Check if fee-bump fallback succeeds
      try {
        if (typeof StellarSdk.FeeBumpTransaction === 'function') {
          envelope = new StellarSdk.FeeBumpTransaction(xdr, passphrase);
          decoded = decodeFeeBump(envelope, options);
        } else {
          throw parseError;
        }
      } catch (feeBumpError) {
        if (feeBumpError.code === 'OPERATION_LIMIT_EXCEEDED') {
          throw feeBumpError;
        }
        log.warn('XDR_INSPECTOR', 'Failed to parse XDR envelope', {
          error: parseError.message,
          feeBumpError: feeBumpError.message,
        });

        const vErr = new ValidationError(
          `Failed to parse XDR envelope: ${parseError.message}`,
          { xdrError: parseError.message, feeBumpError: feeBumpError.message },
          'INVALID_XDR'
        );
        vErr.code = 'INVALID_XDR';
        throw vErr;
      }
    }

    decoded.networkPassphrase = passphrase;
    return decoded;
  }

  /**
   * Inspect transaction summary (for admin inspection endpoints).
   * @param {string} xdr - Base64 XDR
   * @param {Object} [options]
   * @returns {Object} Inspection breakdown
   */
  static inspect(xdr, options = {}) {
    const decoded = XdrInspector.decode(xdr, options);
    return {
      hash: decoded.hash,
      network: options.network ? options.network.toUpperCase() : (process.env.STELLAR_NETWORK || 'TESTNET').toUpperCase(),
      source: decoded.source,
      fee: decoded.fee,
      memo: decoded.memo,
      operationCount: decoded.operationCount,
      operations: decoded.operations,
      timeBounds: decoded.timeBounds
        ? { minTime: decoded.timeBounds.minTime, maxTime: decoded.timeBounds.maxTime }
        : null,
      sequence: decoded.sequence,
    };
  }

  static getDefaultNetworkPassphrase() {
    return getDefaultNetworkPassphrase();
  }
}

module.exports = {
  XdrInspector,
  getDefaultNetworkPassphrase,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_DEPTH,
};
