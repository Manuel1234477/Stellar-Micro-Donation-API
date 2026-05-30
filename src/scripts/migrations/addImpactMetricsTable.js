/**
 * Migration: Add Impact Metrics Table
 *
 * Creates the impact_metrics table for storing per-campaign impact definitions
 * (e.g., "$10 = 1 meal"). Used by ImpactMetricService to calculate donor impact.
 */

const Database = require('../../utils/database');

/**
 * Run the migration — creates impact_metrics table and supporting index.
 * @returns {Promise<void>}
 */
async function up() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS impact_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      unit TEXT NOT NULL,
      amount_per_unit REAL NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  await Database.run(`
    CREATE INDEX IF NOT EXISTS idx_impact_metrics_campaign_id
    ON impact_metrics(campaign_id)
  `);
}

/**
 * Reverse the migration — drops impact_metrics table.
 * @returns {Promise<void>}
 */
async function down() {
  await Database.run('DROP TABLE IF EXISTS impact_metrics');
}

module.exports = { up, down };
