const StellarSdk = require('stellar-sdk');
const { ValidationError, ERROR_CODES } = require('./errors');

const NATIVE_ASSET_CODE = 'XLM';

/**
 * Parse a Stellar asset value from a request body or query string.
 * Supports the string value `native` or an object with `code` and `issuer`.
 *
 * @param {string|Object|null|undefined} value - Raw asset input.
 * @param {string} fieldName - Field name for validation errors.
 * @returns {{ type: 'native'|'credit_alphanum', code: string, issuer: string|null }}
 */
function parseAssetInput(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError(
      `${fieldName} is required`,
      null,
      ERROR_CODES.MISSING_REQUIRED_FIELD
    );
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (trimmed.toLowerCase() === 'native' || trimmed.toUpperCase() === NATIVE_ASSET_CODE) {
      return {
        type: 'native',
        code: NATIVE_ASSET_CODE,
        issuer: null,
      };
    }

    try {
      const parsed = JSON.parse(trimmed);
      return parseAssetInput(parsed, fieldName);
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ValidationError(
          `${fieldName} must be "native" or a JSON object with code and issuer`,
          null,
          ERROR_CODES.INVALID_REQUEST
        );
      }

      throw error;
    }
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError(
      `${fieldName} must be an object`,
      null,
      ERROR_CODES.INVALID_REQUEST
    );
  }

  const code = typeof value.code === 'string' ? value.code.trim() : '';
  const issuer = typeof value.issuer === 'string' ? value.issuer.trim() : '';
  const type = typeof value.type === 'string' ? value.type.trim().toLowerCase() : undefined;

  if (type === 'native' || (!code && !issuer)) {
    return {
      type: 'native',
      code: NATIVE_ASSET_CODE,
      issuer: null,
    };
  }

  if (!/^[A-Z0-9]{1,12}$/.test(code)) {
    throw new ValidationError(
      `${fieldName}.code must be 1-12 uppercase alphanumeric characters`,
      null,
      ERROR_CODES.INVALID_REQUEST
    );
  }

  if (!issuer || !StellarSdk.StrKey.isValidEd25519PublicKey(issuer)) {
    throw new ValidationError(
      `${fieldName}.issuer must be a valid Stellar public key`,
      null,
      ERROR_CODES.INVALID_REQUEST
    );
  }

  return {
    type: 'credit_alphanum',
    code,
    issuer,
  };
}

/**
 * Convert a normalized asset object into a Stellar SDK asset.
 *
 * @param {{ type: string, code: string, issuer: string|null }} asset - Normalized asset.
 * @returns {import('stellar-sdk').Asset} Stellar SDK asset instance.
 */
function toStellarSdkAsset(asset) {
  if (asset.type === 'native') {
    return StellarSdk.Asset.native();
  }

  return new StellarSdk.Asset(asset.code, asset.issuer);
}

/**
 * Build a stable string key for an asset.
 *
 * @param {{ type: string, code: string, issuer: string|null }} asset - Normalized asset.
 * @returns {string} Stable asset key.
 */
function getAssetKey(asset) {
  return asset.type === 'native' ? 'native' : `${asset.code}:${asset.issuer}`;
}

/**
 * Compare two normalized assets.
 *
 * @param {{ type: string, code: string, issuer: string|null }} left - First asset.
 * @param {{ type: string, code: string, issuer: string|null }} right - Second asset.
 * @returns {boolean} True when assets are equivalent.
 */
function isSameAsset(left, right) {
  return getAssetKey(left) === getAssetKey(right);
}

/**
 * Convert a Horizon path asset record to the normalized asset format.
 *
 * @param {{ asset_type?: string, asset_code?: string, asset_issuer?: string }} record - Horizon path asset.
 * @returns {{ type: 'native'|'credit_alphanum', code: string, issuer: string|null }} Normalized asset.
 */
function normalizeHorizonAsset(record) {
  if (!record || record.asset_type === 'native') {
    return {
      type: 'native',
      code: NATIVE_ASSET_CODE,
      issuer: null,
    };
  }

  return {
    type: 'credit_alphanum',
    code: record.asset_code,
    issuer: record.asset_issuer,
  };
}

/**
 * Convert a normalized asset to a JSON-safe API payload.
 *
 * @param {{ type: string, code: string, issuer: string|null }} asset - Normalized asset.
 * @returns {{ type: string, code: string, issuer: string|null }} API-safe asset payload.
 */
function serializeAsset(asset) {
  return {
    type: asset.type,
    code: asset.code,
    issuer: asset.issuer,
  };
}

module.exports = {
  NATIVE_ASSET_CODE,
  parseAssetInput,
  toStellarSdkAsset,
  getAssetKey,
  isSameAsset,
  normalizeHorizonAsset,
  serializeAsset,
};
