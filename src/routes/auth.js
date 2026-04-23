/**
 * Auth Routes - JWT Token Issuance and Stellar SEP-0010 Authentication
 *
 * POST /auth/token/apikey - Exchange a valid API key for an access + refresh token pair
 * POST /auth/refresh     - Rotate a refresh token; returns new access + refresh tokens
 * GET  /auth/challenge   - Generate SEP-0010 challenge transaction for Stellar authentication
 * POST /auth/token       - Verify signed SEP-0010 challenge and return JWT token
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const {
  issueTokenPair,
  rotateRefreshToken,
} = require('../services/JwtService');
const SEP10Service = require('../services/SEP10Service');
const config = require('../config');
const { getStellarService } = require('../config/stellar');
const log = require('../utils/log');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

const stellarService = getStellarService();
const sep10Config = config.sep10 || {};
const serverSigningKey =
  config.stellar?.serviceSecretKey ||
  process.env.SERVICE_SECRET_KEY ||
  process.env.STELLAR_SECRET ||
  null;

const sep10Service = serverSigningKey
  ? new SEP10Service(stellarService, {
      serverSigningKey,
      homeDomain: sep10Config.homeDomain || process.env.HOME_DOMAIN || 'localhost',
      challengeExpiresIn: (sep10Config.challengeTtlSeconds || 300) * 1000,
    })
  : null;

/**
 * POST /auth/token/apikey
 * Exchange a valid API key for a JWT access token + refresh token pair.
 * Requires: X-API-Key header
 */
router.post('/token/apikey', requireApiKey, payloadSizeLimiter(ENDPOINT_LIMITS.auth), asyncHandler(async (req, res) => {
  try {
    const apiKeyId = req.apiKey.id || 0;
    const claims = { role: req.apiKey.role || 'user' };
    const { accessToken, refreshToken, familyId } = await issueTokenPair(apiKeyId, claims);

    log.info('AUTH', 'Token pair issued', { apiKeyId, familyId });

    return res.status(200).json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        tokenType: 'Bearer',
        expiresIn: 900, // 15 minutes in seconds
      },
    });
  } catch (err) {
    log.error('AUTH', 'Failed to issue token pair', { error: err.message });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to issue tokens' } });
  }
}));

/**
 * POST /auth/refresh
 * Rotate a refresh token. Returns a new access token + refresh token.
 * Body: { refreshToken: string }
 */
router.post('/refresh', payloadSizeLimiter(ENDPOINT_LIMITS.auth), asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};

  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_REFRESH_TOKEN', message: 'refreshToken is required' },
    });
  }

  try {
    const result = await rotateRefreshToken(refreshToken);

    if (!result) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid or expired' },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: 'Bearer',
        expiresIn: 900,
      },
    });
  } catch (err) {
    if (err.code === 'TOKEN_FAMILY_REVOKED') {
      return res.status(401).json({
        success: false,
        error: { code: 'TOKEN_FAMILY_REVOKED', message: 'Token reuse detected; all sessions revoked' },
      });
    }
    log.error('AUTH', 'Refresh token rotation failed', { error: err.message });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to refresh token' } });
  }
}));

/**
 * GET /auth/challenge
 * Returns a SEP-0010 challenge transaction XDR that the client can sign.
 * Query params: account=<stellar_public_key>
 */
router.get('/challenge', asyncHandler(async (req, res) => {
  if (!sep10Service) {
    return res.status(501).json({
      success: false,
      error: { code: 'SEP10_NOT_CONFIGURED', message: 'SEP-0010 authentication is not available' },
    });
  }

  const account = req.query.account;
  if (!account || typeof account !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_ACCOUNT', message: 'account query parameter is required' },
    });
  }

  try {
    const challengeXDR = await sep10Service.generateChallenge(account);
    return res.status(200).json({ success: true, data: { transaction: challengeXDR } });
  } catch (err) {
    log.error('AUTH', 'Challenge generation failed', { error: err.message });
    return res.status(400).json({ success: false, error: { code: 'INVALID_CHALLENGE', message: err.message } });
  }
}));

/**
 * POST /auth/token
 * Verifies a signed SEP-0010 challenge and returns a JWT access token.
 * Body: { transaction: '<signed_tx_xdr>' }
 */
router.post('/token', payloadSizeLimiter(ENDPOINT_LIMITS.auth), asyncHandler(async (req, res) => {
  if (!sep10Service) {
    return res.status(501).json({
      success: false,
      error: { code: 'SEP10_NOT_CONFIGURED', message: 'SEP-0010 authentication is not available' },
    });
  }

  const payload = req.body || {};
  const signedTx = payload.transaction;

  if (!signedTx || typeof signedTx !== 'string') {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_TRANSACTION', message: 'transaction is required' },
    });
  }

  try {
    const account = await sep10Service.verifyChallenge(signedTx);
    const accessToken = sep10Service.issueAuthToken(account);
    return res.status(200).json({
      success: true,
      data: {
        accessToken,
        tokenType: 'Bearer',
        expiresIn: 900,
        account,
      },
    });
  } catch (err) {
    log.error('AUTH', 'Challenge verification failed', { error: err.message });
    return res.status(401).json({ success: false, error: { code: 'INVALID_CHALLENGE', message: err.message } });
  }
}));

module.exports = router;
