const PREDEFINED_TAGS = [
  'education',
  'health',
  'disaster-relief',
  'technology',
  'environment',
  'humanitarian',
  'arts',
  'sports',
  'animal-welfare'
];

const CUSTOM_TAG_PATTERN = /^[a-z0-9\-_]+$/;
const CUSTOM_TAG_MAX_LENGTH = 50;

/**
 * Validate a single tag value.
 * @param {string} tag
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateTag(tag) {
  if (typeof tag !== 'string' || tag.length === 0) {
    return { valid: false, reason: 'Tag must be a non-empty string' };
  }
  if (PREDEFINED_TAGS.includes(tag)) return { valid: true };
  if (tag.length > CUSTOM_TAG_MAX_LENGTH) {
    return { valid: false, reason: `Custom tag must be ${CUSTOM_TAG_MAX_LENGTH} characters or fewer` };
  }
  if (!CUSTOM_TAG_PATTERN.test(tag)) {
    return { valid: false, reason: 'Custom tag must match /^[a-z0-9-_]+$/' };
  }
  return { valid: true };
}

module.exports = {
  PREDEFINED_TAGS,
  CUSTOM_TAG_PATTERN,
  CUSTOM_TAG_MAX_LENGTH,
  validateTag,
};
