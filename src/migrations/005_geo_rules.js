'use strict';

exports.name = '005_geo_rules';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS geo_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      countryCode TEXT NOT NULL,
      ruleType TEXT NOT NULL CHECK(ruleType IN ('allow', 'block')),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy TEXT,
      UNIQUE(countryCode, ruleType)
    )
  `);

  await db.run(
    'CREATE INDEX IF NOT EXISTS idx_geo_rules_type_country ON geo_rules(ruleType, countryCode)'
  );
};
