const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { PREDEFINED_TAGS } = require('../constants/tags');

/**
 * GET /tags
 * Returns predefined tags and custom tag eligibility based on role
 */
router.get('/', requireApiKey, (req, res) => {
  const role = req.user?.role || req.apiKey?.role || 'user';
  
  res.json({
    success: true,
    data: {
      predefined: PREDEFINED_TAGS,
      customAllowed: role === 'premium' || role === 'admin'
    }
  });
});

module.exports = router;
