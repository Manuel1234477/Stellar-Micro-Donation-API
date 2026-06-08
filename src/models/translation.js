'use strict';

const Database = require('../utils/database');

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS translations (
    key         TEXT PRIMARY KEY,
    translations TEXT NOT NULL DEFAULT '{}',
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`;

async function initTable() {
  await Database.run(CREATE_TABLE);
}

class TranslationDoc {
  constructor({ key, translations = {}, updated_at } = {}) {
    this.key = key;
    this.translations = new Map(Object.entries(
      typeof translations === 'string' ? JSON.parse(translations) : translations
    ));
    this.updatedAt = updated_at ? new Date(updated_at) : new Date();
  }

  async save() {
    await initTable();
    const json = JSON.stringify(Object.fromEntries(this.translations));
    await Database.run(
      `INSERT INTO translations (key, translations, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET translations = excluded.translations, updated_at = excluded.updated_at`,
      [this.key, json, new Date(this.updatedAt).toISOString()]
    );
  }

  static async find(filter = {}, projection) {
    await initTable();
    const rows = await Database.all(`SELECT * FROM translations`);
    return (rows || []).map(r => new TranslationDoc(r));
  }

  static async findOne(filter = {}) {
    await initTable();
    if (filter.key !== undefined) {
      const row = await Database.get(`SELECT * FROM translations WHERE key = ?`, [filter.key]);
      return row ? new TranslationDoc(row) : null;
    }
    const row = await Database.get(`SELECT * FROM translations LIMIT 1`);
    return row ? new TranslationDoc(row) : null;
  }
}

module.exports = TranslationDoc;
