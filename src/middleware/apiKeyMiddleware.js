const validKeys = (process.env.API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];

  if (!validKeys.length || !key || !validKeys.includes(key)) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Valid API key required. Provide it via the x-api-key header.'
      }
    });
  }

  next();
}

module.exports = requireApiKey;
