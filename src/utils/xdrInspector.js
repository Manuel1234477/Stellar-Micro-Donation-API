'use strict';

const { TransactionBuilder, Networks, StrKey } = require('@stellar/stellar-sdk');

let config;
try {
  config = require('../config');
} catch (err) {
  config = {};
}

const DEFAULT_MAX_OPERATIONS = 100;
const DEFAULT_MAX_DEPTH = 20;
const DEFAULT_MAX_XDR_LENGTH = 100 * 1024;

class XdrInspectorError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'XdrInspectorError';
    this.code = code || 'XDR_INSPECTION_ERROR';
    if (details) {
      this.details = details;
    }
  }
}

function resolveDefaultNetworkPassphrase() {
  if (config && typeof config.networkPassphrase === 'string' && config.networkPassphrase) {
    return config.networkPassphrase;
  }
  if (config && typeof config.stellarNetwork === 'string') {
    const net = config.stellarNetwork.toLowerCase();
    if (net === 'public' || net === 'mainnet') {
      return Networks.PUBLIC;
    }
    if (net === 'futurenet') {
      return Networks.FUTURENET;
    }
    if (net === 'testnet') {
      return Networks.TESTNET;
    }
  }
  if (config && config.network && typeof config.network.passphrase === 'string') {
    return config.network.passphrase;
  }
  return Networks.TESTNET;
}

function getLimits(options) {
  const opts = options || {};
  const cfg = (config && config.xdrInspector) || {};
  return {
    maxOperations:
      opts.maxOperations != null
        ? opts.maxOperations
        : cfg.maxOperations != null
          ? cfg.maxOperations
          : DEFAULT_MAX_OPERATIONS,
    maxDepth:
      opts.maxDepth != null
        ? opts.maxDepth
        : cfg.maxDepth != null
          ? cfg.maxDepth
          : DEFAULT_MAX_DEPTH,
    maxXdrLength:
      opts.maxXdrLength != null
        ? opts.maxXdrLength
        : cfg.maxXdrLength != null
          ? cfg.maxXdrLength
          : DEFAULT_MAX_XDR_LENGTH,
  };
}

function validateXdrInput(xdr, limits) {
  if (typeof xdr !== 'string' || xdr.trim() === '') {
    throw new XdrInspectorError('XDR string is required', 'INVALID_XDR_INPUT');
  }
  if (xdr.length > limits.maxXdrLength) {
    throw new XdrInspectorError(
      `XDR exceeds maximum length of ${limits.maxXdrLength} characters`,
      'XDR_TOO_LARGE',
      { length: xdr.length, maxXdrLength: limits.maxXdrLength },
    );
  }
}

/**
 * Estimate nesting depth of a decoded XDR value without full recursive traversal
 * of arbitrary user input. Uses an iterative walk with a hard cap so it cannot
 * itself become a DoS vector.
 */
function measureDepth(value, maxDepth) {
  const stack = [{ value, depth: 0 }];
  let deepest = 0;
  let visited = 0;
  const maxVisited = 100000;

  while (stack.length > 0) {
    const { value: current, depth } = stack.pop();
    visited += 1;
    if (visited > maxVisited) {
      throw new XdrInspectorError(
        'XDR structure is too complex to inspect',
        'XDR_TOO_COMPLEX',
      );
    }
    if (depth > deepest) {
      deepest = depth;
    }
    if (deepest > maxDepth) {
      throw new XdrInspectorError(
        `XDR nesting depth exceeds maximum of ${maxDepth}`,
        'XDR_DEPTH_EXCEEDED',
        { maxDepth },
      );
    }
    if (current && typeof current === 'object') {
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length; i += 1) {
          stack.push({ value: current[i], depth: depth + 1 });
        }
      } else {
        const keys = Object.keys(current);
        for (let i = 0; i < keys.length; i += 1) {
          stack.push({ value: current[keys[i]], depth: depth + 1 });
        }
      }
    }
  }

  return deepest;
}

function safeString(value) {
  if (value == null) {
    return null;
  }
  try {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value.toString === 'function') {
      const str = value.toString();
      return str === '[object Object]' ? null : str;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function normalizeTimeBounds(tx) {
  try {
    const tb = tx.timeBounds;
    if (!tb) {
      return null;
    }
    return {
      minTime: tb.minTime != null ? String(tb.minTime) : null,
      maxTime: tb.maxTime != null ? String(tb.maxTime) : null,
    };
  } catch (err) {
    return null;
  }
}

function normalizeMemo(tx) {
  try {
    const memo = tx.memo;
    if (!memo) {
      return null;
    }
    const type = memo.type || 'none';
    if (type === 'none') {
      return { type: 'none', value: null };
    }
    let value = null;
    try {
      if (typeof memo.value === 'string') {
        value = memo.value;
      } else if (memo.value != null && typeof memo.value.toString === 'function') {
        value = memo.value.toString();
      }
    } catch (err) {
      value = null;
    }
    return { type, value };
  } catch (err) {
    return null;
  }
}

function normalizeOperation(op, index) {
  const normalized = {
    index,
    type: op && op.type ? op.type : 'unknown',
    source: op && op.source ? safeString(op.source) : null,
  };

  try {
    switch (normalized.type) {
      case 'payment':
        normalized.destination = safeString(op.destination);
        normalized.asset = op.asset ? safeString(op.asset) : null;
        normalized.amount = op.amount != null ? String(op.amount) : null;
        break;
      case 'createAccount':
        normalized.destination = safeString(op.destination);
        normalized.startingBalance =
          op.startingBalance != null ? String(op.startingBalance) : null;
        break;
      case 'changeTrust':
        normalized.asset = op.asset ? safeString(op.asset) : null;
        normalized.limit = op.limit != null ? String(op.limit) : null;
        break;
      case 'manageSellOffer':
      case 'manageBuyOffer':
        normalized.selling = op.selling ? safeString(op.selling) : null;
        normalized.buying = op.buying ? safeString(op.buying) : null;
        normalized.amount = op.amount != null ? String(op.amount) : null;
        normalized.price = op.price != null ? String(op.price) : null;
        normalized.offerId = op.offerId != null ? String(op.offerId) : null;
        break;
      case 'setOptions':
        normalized.inflationDest = op.inflationDest ? safeString(op.inflationDest) : null;
        normalized.homeDomain = op.homeDomain != null ? op.homeDomain : null;
        break;
      case 'invokeHostFunction':
        normalized.function = op.func ? safeString(op.func) : null;
        break;
      default:
        break;
    }
  } catch (err) {
    // Best-effort normalization; never fail the whole decode on one op.
  }

  return normalized;
}

function normalizeSignatures(tx) {
  try {
    const signatures = tx.signatures || [];
    return signatures.map((sig, index) => {
      let hint = null;
      let signature = null;
      try {
        if (sig && sig.hint != null) {
          hint = Buffer.isBuffer(sig.hint)
            ? sig.hint.toString('hex')
            : safeString(sig.hint);
        }
        if (sig && sig.signature != null) {
          signature = Buffer.isBuffer(sig.signature)
            ? sig.signature.toString('base64')
            : safeString(sig.signature);
        }
      } catch (err) {
        // ignore
      }
      return { index, hint, signature };
    });
  } catch (err) {
    return [];
  }
}

/**
 * Decode an XDR envelope string into a normalized breakdown.
 *
 * @param {string} xdr - base64-encoded transaction envelope XDR
 * @param {object} [options]
 * @param {string} [options.networkPassphrase] - defaults to server-configured network
 * @param {number} [options.maxOperations]
 * @param {number} [options.maxDepth]
 * @param {number} [options.maxXdrLength]
 * @returns {object} normalized decoded transaction
 */
function inspectXdr(xdr, options) {
  const opts = options || {};
  const limits = getLimits(opts);

  validateXdrInput(xdr, limits);

  const networkPassphrase =
    typeof opts.networkPassphrase === 'string' && opts.networkPassphrase
      ? opts.networkPassphrase
      : resolveDefaultNetworkPassphrase();

  let tx;
  try {
    tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (err) {
    throw new XdrInspectorError(
      'Invalid XDR: unable to decode transaction envelope',
      'INVALID_XDR',
      { cause: err && err.message ? err.message : String(err) },
    );
  }

  if (!tx) {
    throw new XdrInspectorError('Invalid XDR: empty transaction', 'INVALID_XDR');
  }

  // Enforce structural limits before doing expensive normalization.
  measureDepth(tx, limits.maxDepth);

  let operations = [];
  try {
    operations = tx.operations || [];
  } catch (err) {
    throw new XdrInspectorError(
      'Invalid XDR: unable to read operations',
      'INVALID_XDR',
      { cause: err && err.message ? err.message : String(err) },
    );
  }

  if (operations.length > limits.maxOperations) {
    throw new XdrInspectorError(
      `Transaction exceeds maximum of ${limits.maxOperations} operations`,
      'XDR_TOO_MANY_OPERATIONS',
      { operations: operations.length, maxOperations: limits.maxOperations },
    );
  }

  const normalizedOperations = operations.map((op, index) =>
    normalizeOperation(op, index),
  );

  let hash = null;
  try {
    hash = typeof tx.hash === 'function' ? tx.hash().toString('hex') : null;
  } catch (err) {
    hash = null;
  }

  let source = null;
  try {
    source = tx.source ? safeString(tx.source) : null;
  } catch (err) {
    source = null;
  }

  let fee = null;
  try {
    fee = tx.fee != null ? String(tx.fee) : null;
  } catch (err) {
    fee = null;
  }

  let sequence = null;
  try {
    sequence = tx.sequence != null ? String(tx.sequence) : null;
  } catch (err) {
    sequence = null;
  }

  return {
    hash,
    source,
    fee,
    sequence,
    memo: normalizeMemo(tx),
    timeBounds: normalizeTimeBounds(tx),
    operations: normalizedOperations,
    signatures: normalizeSignatures(tx),
    networkPassphrase,
    operationCount: normalizedOperations.length,
  };
}

/**
 * Convenience wrapper returning a result object instead of throwing.
 */
function tryInspectXdr(xdr, options) {
  try {
    return { ok: true, result: inspectXdr(xdr, options) };
  } catch (err) {
    if (err instanceof XdrInspectorError) {
      return { ok: false, error: err };
    }
    return {
      ok: false,
      error: new XdrInspectorError(
        err && err.message ? err.message : 'XDR inspection failed',
        'XDR_INSPECTION_ERROR',
      ),
    };
  }
}

module.exports = {
  XdrInspectorError,
  inspectXdr,
  tryInspectXdr,
  resolveDefaultNetworkPassphrase,
  getLimits,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_XDR_LENGTH,
};