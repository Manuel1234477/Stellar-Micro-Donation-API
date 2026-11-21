const Database = require('../../src/utils/database');
const TranslationDoc = require('../../src/models/translation');

describe('TranslationDoc.find', () => {
  afterEach(async () => {
    await Database.run('DELETE FROM translations WHERE key IN (?, ?)', ['en', 'fr']);
  });

  test('applies filter and returns only matching rows', async () => {
    const enTranslation = new TranslationDoc({
      key: 'en',
      translations: { hello: 'Hello' },
    });
    const frTranslation = new TranslationDoc({
      key: 'fr',
      translations: { hello: 'Bonjour' },
    });

    await enTranslation.save();
    await frTranslation.save();

    const results = await TranslationDoc.find({ key: 'en' });

    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('en');
    expect(results[0].translations.get('hello')).toBe('Hello');
  });

  test('supports projection to limit returned columns', async () => {
    const enTranslation = new TranslationDoc({
      key: 'en',
      translations: { hello: 'Hello' },
    });
    await enTranslation.save();

    const results = await TranslationDoc.find({ key: 'en' }, ['key']);

    expect(results).toHaveLength(1);
    expect(results[0].key).toBe('en');
    expect(results[0].translations.size).toBe(0);
  });
});
