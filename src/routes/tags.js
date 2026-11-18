const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { PREDEFINED_TAGS } = require('../constants/tags');
const TagService = require('../services/TagService');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /tags
 * Returns predefined tags, custom tag eligibility based on role, and known tags with donation counts
 */
router.get('/', requireApiKey, asyncHandler(async (req, res) => {
  const role = req.user?.role || req.apiKey?.role || 'user';
  const knownTags = await TagService.getAllWithCounts();

  res.json({
    success: true,
    data: {
      predefined: PREDEFINED_TAGS,
      customAllowed: role === 'premium' || role === 'admin',
      tags: knownTags,
      totalTags: knownTags.length,
    }
  });
}));

module.exports = router;
