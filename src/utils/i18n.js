/**
 * i18n Utility
 *
 * RESPONSIBILITY: Language detection and message translation for error responses
 * OWNER: Backend Team
 * DEPENDENCIES: Translation files in src/i18n/
 *
 * Security: Translation keys are internal constants — user input (Accept-Language)
 * is only used to select a language, never as a key into the translation map.
 */

'use strict';

const TRANSLATIONS = {
  en: require('../i18n/en'),
  es: require('../i18n/es'),
  fr: require('../i18n/fr'),
  pt: require('../i18n/pt'),
};

const SUPPORTED = new Set(Object.keys(TRANSLATIONS));
const DEFAULT_LANG = 'en';

/**
 * Parse an Accept-Language header and return the best supported language.
 * Falls back to English for unsupported or missing values.
 *
 * @param {string|undefined} acceptLanguage - Value of the Accept-Language header
 * @returns {'en'|'es'|'fr'|'pt'} Supported language code
 */
function parseLanguage(acceptLanguage) {
  if (!acceptLanguage || typeof acceptLanguage !== 'string') return DEFAULT_LANG;

  // Parse "es-MX,es;q=0.9,en;q=0.8" into [{ lang, q }] sorted by quality
  const entries = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag, q] = part.trim().split(';q=');
      const lang = tag.trim().split('-')[0].toLowerCase(); // "es-MX" -> "es"
      return { lang, q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { lang } of entries) {
    if (SUPPORTED.has(lang)) return lang;
  }
  return DEFAULT_LANG;
}

/**
 * Get a translated message for a given error code and language.
 * Falls back to English if the key or language is not found.
 *
 * @param {string} key - Error code key (e.g. 'VALIDATION_ERROR')
 * @param {string} lang - Language code (e.g. 'es')
 * @returns {string|null} Translated message, or null if key is unknown
 */
function getMessage(key, lang) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS[DEFAULT_LANG];
  return dict[key] || TRANSLATIONS[DEFAULT_LANG][key] || null;
}

module.exports = { parseLanguage, getMessage, SUPPORTED_LANGUAGES: [...SUPPORTED] };
