const Translation = require('../models/translation');
const log = require('./log');

// In-memory cache
let translationCache = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds (as per acceptance criteria)

const loadTranslations = async () => {
  const now = Date.now();
  
  // Return cache if still valid
  if (now - lastCacheUpdate < CACHE_TTL && Object.keys(translationCache).length > 0) {
    return translationCache;
  }

  try {
    const translations = await Translation.find({});
    translationCache = {};

    translations.forEach((doc) => {
      translationCache[doc.key] = doc.translations || {};
    });

    lastCacheUpdate = now;
    log.info('I18N', 'Loaded translation keys from DB', { count: Object.keys(translationCache).length });
    
    return translationCache;
  } catch (error) {
    log.error('I18N', 'Failed to load translations from DB', { error: error.message });
    return translationCache; // fallback to existing cache
  }
};

/**
 * Get translation for a key and language
 * @param {string} key - Translation key (e.g. "error.validation.required")
 * @param {string} lang - Language code (en, es, fr, pt, etc.)
 * @returns {string} Translated string or fallback
 */
const t = async (key, lang = 'en') => {
  const translations = await loadTranslations();
  
  const langTranslations = translations[key] || {};
  
  // Return requested language
  if (langTranslations[lang]) {
    return langTranslations[lang];
  }
  
  // Fallback to English
  if (langTranslations['en']) {
    return langTranslations['en'];
  }
  
  // Ultimate fallback
  return key;
};

/**
 * Get all translations for a specific language
 */
const getAllForLanguage = async (lang = 'en') => {
  const translations = await loadTranslations();
  const result = {};
  
  Object.keys(translations).forEach(key => {
    result[key] = translations[key][lang] || translations[key]['en'] || key;
  });
  
  return result;
};

module.exports = {
  t,
  getAllForLanguage,
  loadTranslations // exported for admin usage
};