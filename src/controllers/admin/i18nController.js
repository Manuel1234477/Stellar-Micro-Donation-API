const Translation = require('../../models/Translation');
const i18n = require('../../utils/i18n');

// In-memory cache
let translationCache = {};
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 60 seconds

const loadTranslationsToCache = async () => {
  const now = Date.now();
  if (now - lastCacheUpdate < CACHE_TTL) return translationCache;

  const translations = await Translation.find({});
  translationCache = {};

  translations.forEach(t => {
    translationCache[t.key] = t.translations;
  });

  lastCacheUpdate = now;
  return translationCache;
};

// GET /admin/i18n/messages
exports.getAllMessages = async (req, res) => {
  try {
    await loadTranslationsToCache();

    const messages = Object.keys(translationCache).map(key => ({
      key,
      translations: translationCache[key] || {}
    }));

    res.json({ success: true, messages });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// PATCH /admin/i18n/messages/:lang/:key
exports.updateTranslation = async (req, res) => {
  try {
    const { lang, key } = req.params;
    const { value } = req.body;

    if (!value) return res.status(400).json({ error: 'Value is required' });

    let translation = await Translation.findOne({ key });

    if (!translation) {
      translation = new Translation({ key, translations: {} });
    }

    translation.translations.set(lang, value);
    translation.updatedAt = Date.now();
    await translation.save();

    // Clear cache so next request reloads
    lastCacheUpdate = 0;

    res.json({ 
      success: true, 
      message: 'Translation updated',
      updated: { key, lang, value }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// POST /admin/i18n/languages
exports.addLanguage = async (req, res) => {
  try {
    const { code, name, translations = {} } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: 'Language code and name are required' });
    }

    // Seed all existing keys with empty string for new language
    const existingKeys = await Translation.find({}, 'key');
    
    for (const { key } of existingKeys) {
      let trans = await Translation.findOne({ key });
      if (trans && !trans.translations.has(code)) {
        trans.translations.set(code, translations[key] || '');
        await trans.save();
      }
    }

    lastCacheUpdate = 0;

    res.status(201).json({
      success: true,
      message: `Language ${code} (${name}) added successfully`
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};