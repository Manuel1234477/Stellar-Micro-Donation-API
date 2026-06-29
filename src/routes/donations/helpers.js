/**
 * Donations Sub-Router — Shared Helpers
 *
 * All shared schemas, helper functions, and constants used across the
 * donations sub-routers are defined here. This avoids duplication and
 * circular-require issues between sibling modules.
 */

'use strict';

const { validateSchema } = require('../../middleware/schemaValidation');
const { isValidStellarPublicKey } = require('../../utils/validators');
const { LIFECYCLE_STAGES } = require('../../middleware/requestLifecycle');

// ─── Schemas ──────────────────────────────────────────────────────────────────

const donationIdParamSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

const updateDonationStatusSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  },
  body: {
    fields: {
      status: { type: 'string', required: true, enum: ['pending', 'submitted', 'confirmed', 'failed'] }
    }
  }
});

const sendDonationSchema = validateSchema({
  body: {
    fields: {
      senderId: { type: 'string', required: true, trim: true, minLength: 1 },
      receiverId: { type: 'string', required: true, trim: true, minLength: 1 },
      amount: { type: 'number', required: true },
      memo: { type: 'string', required: false, maxLength: 28, nullable: true },
      campaign_id: { type: 'string', required: false, nullable: true }
    }
  }
});

const createDonationSchema = validateSchema({
  body: {
    fields: {
      amount: { types: ['number', 'numberString'], required: true },
      recipient: {
        type: 'string',
        required: false,
        trim: true,
        minLength: 1,
        nullable: true,
        validate: (value) => {
          if (typeof value === 'string' && value.includes('*')) return true;
          return isValidStellarPublicKey(value)
            ? true
            : 'address must be a valid Stellar public key (56-character Ed25519 public key starting with G)';
        },
      },
      senderId: { types: ['number', 'numberString', 'string'], required: false, nullable: true },
      receiverId: { types: ['number', 'numberString', 'string'], required: false, nullable: true },
      currency: { type: 'string', required: false, nullable: true },
      donor: { type: 'string', required: false, nullable: true },
      memo: { type: 'string', required: false, maxLength: 28, nullable: true },
      memoType: { type: 'string', required: false, nullable: true },
      notes: { type: 'string', required: false, nullable: true },
      tags: { type: 'array', required: false, nullable: true },
      sourceAsset: { type: 'string', required: false, nullable: true },
      sourceAmount: { types: ['number', 'numberString'], required: false, nullable: true }
    }
  }
});

const statsByTagQuerySchema = validateSchema({
  query: {
    fields: {
      startDate: { type: 'dateString', required: true },
      endDate: { type: 'dateString', required: true },
    },
  },
});

const crossAssetSchema = validateSchema({
  body: {
    fields: {
      signedXDR: { type: 'string', required: true },
      sendAsset: { types: ['string', 'object'], required: true },
      destPublicKey: { type: 'string', required: true },
      destAsset: { types: ['string', 'object'], required: true },
      slippageTolerance: { type: 'number', required: false },
      memo: { type: 'string', required: false, maxLength: 255, nullable: true },
    },
    validate: (body) => {
      if (body.sendAmount === undefined && body.destAmount === undefined) {
        return 'Either sendAmount or destAmount is required';
      }
      if (body.sendAmount !== undefined && body.destAmount !== undefined) {
        return 'Provide either sendAmount (strict-send) or destAmount (strict-receive), not both';
      }
      const tol = body.slippageTolerance;
      if (tol !== undefined && (typeof tol !== 'number' || tol < 0 || tol > 1)) {
        return 'slippageTolerance must be a number between 0 and 1';
      }
      return null;
    },
  },
});

const crossAssetPathsSchema = validateSchema({
  query: {
    fields: {
      sourcePublicKey: { type: 'string', required: true },
      destPublicKey: { type: 'string', required: true },
      destAsset: { type: 'string', required: true },
      destAmount: { type: 'numberString', required: true },
    },
  },
});

const createClaimableSchema = validateSchema({
  body: {
    fields: {
      sourceSecret: { type: 'string', required: true },
      amount: { types: ['number', 'numberString'], required: true },
      claimants: { type: 'array', required: true },
      predicate: { type: 'object', required: false, nullable: true },
    },
  },
});

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Strip the private `notes` field from a donation record unless the requester
 * owns the donation (matching API key) or is an admin.
 */
function applyNotePrivacy(req, tx) {
  if (!tx) return tx;
  const isOwner = req.apiKey && tx.apiKeyId === req.apiKey.id;
  const isAdmin = req.apiKey && req.apiKey.role === 'admin';

  if (!isOwner && !isAdmin && tx.notes !== undefined) {
    const { notes, ...rest } = tx;
    return rest;
  }
  return tx;
}

/**
 * In-memory per-donor serialization lock to prevent TOCTOU on daily limit
 * checks (#806). Acceptable for single-instance deployments; replace with a
 * distributed lock for multi-instance.
 */
const _donorLocks = new Map();
async function withDonorLock(donorId, fn) {
  const prev = _donorLocks.get(donorId) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  _donorLocks.set(donorId, next);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (_donorLocks.get(donorId) === next) _donorLocks.delete(donorId);
  }
}

function formatBatchDonationError(index, code, message) {
  return { success: false, index, error: { code, message } };
}

function formatBatchDonationSuccess(index, data) {
  return { success: true, index, data };
}

module.exports = {
  // Schemas
  donationIdParamSchema,
  updateDonationStatusSchema,
  sendDonationSchema,
  createDonationSchema,
  statsByTagQuerySchema,
  crossAssetSchema,
  crossAssetPathsSchema,
  createClaimableSchema,
  // Helpers
  applyNotePrivacy,
  withDonorLock,
  formatBatchDonationError,
  formatBatchDonationSuccess,
  // Re-exports for convenience
  LIFECYCLE_STAGES,
};
