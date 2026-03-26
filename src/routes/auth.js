/**
 * Auth Routes - JWT Token Issuance and Refresh
 *
 * POST /auth/token   - Exchange a valid API key for an access + refresh token pair
 * POST /auth/refresh - Rotate a refresh token; returns new access + refresh tokens
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const {
  issueTokenPair,
  rotateRefreshToken,
} = require('../services/JwtService');
const log = require('../utils/log');

/**
 * POST /auth/token
 * Exchange a valid API key for a JWT access token + refresh token pair.
 * Requires: X-API-Key header
 */
router.post('/token', requireApiKey, async (req, res) => {
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
});

/**
 * POST /auth/refresh
 * Rotate a refresh token. Returns a new access token + refresh token.
 * Body: { refreshToken: string }
 */
router.post('/refresh', async (req, res) => {
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
});

module.exports = router;
